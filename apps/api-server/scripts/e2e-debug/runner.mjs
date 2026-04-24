#!/usr/bin/env node
/**
 * E2E 推荐系统调试 runner（真实 HTTP）
 * - 通过通用验证码 888888 走真实登录拿 JWT
 * - 批量跑 meal-suggestion / daily-plan
 * - 计算营养偏差、结构异常并打印 JSON 便于机器分析
 */
const BASE = process.env.API_BASE || 'http://localhost:3006/api';

const SEED_USERS = [
  { phone: '13900010001', goal: 'fat_loss',    kcal: 1400, tag: 'fat_loss-A'   },
  { phone: '13900010002', goal: 'muscle_gain', kcal: 2800, tag: 'muscle_gain-A'},
  { phone: '13900010003', goal: 'health',      kcal: 2200, tag: 'health-A'     },
  { phone: '13900010004', goal: 'habit',       kcal: 2100, tag: 'habit-A'      },
  { phone: '13900010005', goal: 'fat_loss',    kcal: 1300, tag: 'fat_loss-B'   },
  { phone: '13900010006', goal: 'muscle_gain', kcal: 3000, tag: 'muscle_gain-B'},
  { phone: '13900010007', goal: 'health',      kcal: 1800, tag: 'health-B'     },
  { phone: '13900010008', goal: 'habit',       kcal: 1800, tag: 'habit-B'      },
];

async function http(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

async function login(phone) {
  await http('/app/auth/phone/send-code', { method: 'POST', body: JSON.stringify({ phone }) });
  const r = await http('/app/auth/phone/verify',     { method: 'POST', body: JSON.stringify({ phone, code: '888888' }) });
  if (!r.body?.data?.token) throw new Error(`login failed ${phone}: ${JSON.stringify(r.body)}`);
  return r.body.data.token;
}

function sum(items, key) { return items.reduce((a, x) => a + (Number(x[key]) || 0), 0); }

// 目标宏分配比例（用于偏差评估）- 减脂/增肌/健康/习惯
const MACRO_TARGETS = {
  fat_loss:    { proteinPct: 0.35, carbsPct: 0.40, fatPct: 0.25 },
  muscle_gain: { proteinPct: 0.30, carbsPct: 0.50, fatPct: 0.20 },
  health:      { proteinPct: 0.25, carbsPct: 0.50, fatPct: 0.25 },
  habit:       { proteinPct: 0.25, carbsPct: 0.50, fatPct: 0.25 },
};

function evalDailyPlan(plan, goal, kcalTarget) {
  const slots = ['morningPlan', 'noonPlan', 'eveningPlan', 'snackPlan'].filter(k => plan?.[k]);
  const issues = [];
  let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
  const slotSummary = {};

  for (const k of slots) {
    const s = plan[k];
    const items = s.foodItems || [];
    const cal = s.calories ?? sum(items, 'calories');
    const p   = s.protein  ?? sum(items, 'protein');
    const f   = s.fat      ?? sum(items, 'fat');
    const c   = s.carbs    ?? sum(items, 'carbs');
    slotSummary[k] = { cal, p, f, c, n: items.length, foods: items.map(x => x.name) };
    totalCal += cal; totalP += p; totalF += f; totalC += c;
    if (!items.length) issues.push(`${k}: 空槽`);
    if (items.length > 6) issues.push(`${k}: 单餐 ${items.length} 种食物过多`);
    if (cal < 50)   issues.push(`${k}: 热量 ${cal}kcal 过低`);
  }

  const kcalDeviation = kcalTarget ? ((totalCal - kcalTarget) / kcalTarget) * 100 : null;
  const t = MACRO_TARGETS[goal] || MACRO_TARGETS.health;
  const actualP = totalCal ? (totalP * 4 / totalCal) : 0;
  const actualC = totalCal ? (totalC * 4 / totalCal) : 0;
  const actualF = totalCal ? (totalF * 9 / totalCal) : 0;
  const macroDev = {
    proteinPP: ((actualP - t.proteinPct) * 100).toFixed(1),
    carbsPP:   ((actualC - t.carbsPct)   * 100).toFixed(1),
    fatPP:     ((actualF - t.fatPct)     * 100).toFixed(1),
  };

  if (kcalDeviation !== null && Math.abs(kcalDeviation) > 15) issues.push(`总热量偏差 ${kcalDeviation.toFixed(1)}%`);
  if (Math.abs(actualP - t.proteinPct) > 0.08) issues.push(`蛋白比例 ${(actualP * 100).toFixed(0)}% vs 目标 ${(t.proteinPct * 100).toFixed(0)}%`);
  if (Math.abs(actualF - t.fatPct) > 0.10)     issues.push(`脂肪比例 ${(actualF * 100).toFixed(0)}% vs 目标 ${(t.fatPct * 100).toFixed(0)}%`);

  return {
    totalCal: Math.round(totalCal),
    totalP: Math.round(totalP),
    totalF: Math.round(totalF),
    totalC: Math.round(totalC),
    kcalDev: kcalDeviation?.toFixed(1),
    macroDev,
    slots: slotSummary,
    issues,
  };
}

async function runOne(u) {
  const out = { user: u.tag, phone: u.phone, goal: u.goal, kcal: u.kcal, errors: [] };
  try {
    const token = await login(u.phone);
    const auth = { Authorization: `Bearer ${token}` };

    const meal = await http('/app/food/meal-suggestion', { headers: auth });
    out.meal = meal.body?.data
      ? {
          mealType: meal.body.data.mealType,
          remaining: meal.body.data.remainingCalories,
          count: meal.body.data.suggestion?.foodItems?.length,
          cal: meal.body.data.suggestion?.calories,
          foods: (meal.body.data.suggestion?.foodItems || []).map(x => x.name),
        }
      : { err: meal.body };

    const plan = await http('/app/food/daily-plan', { headers: auth });
    if (plan.body?.data) {
      out.plan = evalDailyPlan(plan.body.data, u.goal, u.kcal);
    } else {
      out.errors.push(`daily-plan: ${JSON.stringify(plan.body).slice(0, 200)}`);
    }
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  return out;
}

(async () => {
  const filter = process.argv[2]; // optional tag filter
  const targets = filter ? SEED_USERS.filter(u => u.tag.includes(filter)) : SEED_USERS;
  const results = [];
  for (const u of targets) {
    process.stderr.write(`[run] ${u.tag} ${u.goal} ${u.kcal}kcal\n`);
    results.push(await runOne(u));
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
