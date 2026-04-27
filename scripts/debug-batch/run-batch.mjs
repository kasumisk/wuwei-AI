#!/usr/bin/env node
/**
 * 端到端批量测试：4 类用户画像 × ~15 个食物场景 = ~60 个 analyze-text 调用
 * 输出: results.json + report.md
 *
 * 用法:
 *   API_BASE=http://localhost:3007 node scripts/debug-batch/run-batch.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.API_BASE || 'http://localhost:3007';
const OUT_DIR = path.resolve(process.cwd(), 'scripts/debug-batch/out');

// ==================== 测试矩阵 ====================

/** 4 类用户画像 */
const PROFILES = [
  {
    key: 'lose_weight_male',
    label: '减重男性 (BMI 27, 久坐)',
    declared: {
      gender: 'male',
      birthYear: 1990,
      heightCm: 175,
      weightKg: 85,
      targetWeightKg: 72,
      activityLevel: 'sedentary',
      goal: 'fat_loss',
      goalSpeed: 'steady',
      mealsPerDay: 3,
      takeoutFrequency: 'often',
      canCook: false,
      allergens: [],
      healthConditions: [],
      foodPreferences: ['辛辣'],
      dietaryRestrictions: [],
    },
  },
  {
    key: 'gain_muscle_female',
    label: '增肌女性 (健身, 高蛋白需求)',
    declared: {
      gender: 'female',
      birthYear: 1995,
      heightCm: 165,
      weightKg: 55,
      targetWeightKg: 58,
      activityLevel: 'active',
      goal: 'muscle_gain',
      goalSpeed: 'steady',
      mealsPerDay: 5,
      takeoutFrequency: 'sometimes',
      canCook: true,
      allergens: ['peanuts'],
      healthConditions: [],
      foodPreferences: ['高蛋白'],
      dietaryRestrictions: [],
    },
  },
  {
    key: 'maintain_diabetic',
    label: '糖尿病维持型 (低 GI 限制)',
    declared: {
      gender: 'male',
      birthYear: 1975,
      heightCm: 172,
      weightKg: 70,
      targetWeightKg: 70,
      activityLevel: 'light',
      goal: 'health',
      goalSpeed: 'steady',
      mealsPerDay: 3,
      takeoutFrequency: 'sometimes',
      canCook: true,
      allergens: [],
      healthConditions: ['diabetes'],
      foodPreferences: [],
      dietaryRestrictions: [],
    },
  },
  {
    key: 'health_vegetarian',
    label: '健康改善素食女性 (忌口多)',
    declared: {
      gender: 'female',
      birthYear: 1988,
      heightCm: 160,
      weightKg: 58,
      targetWeightKg: 56,
      activityLevel: 'light',
      goal: 'habit',
      goalSpeed: 'relaxed',
      mealsPerDay: 3,
      takeoutFrequency: 'never',
      canCook: true,
      allergens: ['shellfish', 'dairy'],
      healthConditions: ['hypertension'],
      foodPreferences: ['素食'],
      dietaryRestrictions: ['vegetarian'],
    },
  },
];

/** 食物场景（覆盖匹配/未匹配/复合菜/外卖/饮品/零食/单品） */
const FOOD_CASES = [
  // —— 已知 bug 案例（必跑） ——
  { id: 'B1', text: '椰子鸡饭', tag: 'bug-1', mealType: 'lunch', expect: 'NOT 椰子' },
  { id: 'B2', text: '海南鸡饭', tag: 'bug-2', mealType: 'lunch', expect: '~500-700 kcal/份' },
  // —— 库匹配-单品 ——
  { id: 'L1', text: '一个苹果', tag: 'lib-单品', mealType: 'snack' },
  { id: 'L2', text: '香蕉', tag: 'lib-单品', mealType: 'snack' },
  { id: 'L3', text: '200g 鸡胸肉', tag: 'lib-精确量', mealType: 'lunch' },
  { id: 'L4', text: '一碗米饭', tag: 'lib-单品', mealType: 'dinner' },
  // —— LLM 复合菜 ——
  { id: 'C1', text: '黄焖鸡米饭', tag: 'composite-库内', mealType: 'lunch' },
  { id: 'C2', text: '麻辣烫一份', tag: 'composite-外卖', mealType: 'lunch' },
  { id: 'C3', text: '兰州牛肉拉面', tag: 'composite-外卖', mealType: 'lunch' },
  { id: 'C4', text: '肉夹馍+冰峰', tag: 'composite-组合', mealType: 'lunch' },
  { id: 'C5', text: '麦当劳巨无霸套餐', tag: 'composite-连锁', mealType: 'lunch' },
  { id: 'C6', text: '三杯鸡盖饭', tag: 'composite-LLM', mealType: 'dinner' },
  // —— 高糖/高脂/警示 ——
  { id: 'H1', text: '一杯奶茶 全糖', tag: 'high-sugar', mealType: 'snack' },
  { id: 'H2', text: '薯条+可乐', tag: 'high-fat-sugar', mealType: 'snack' },
  { id: 'H3', text: '提拉米苏一块', tag: 'dessert', mealType: 'snack' },
  // —— 饮品 ——
  { id: 'D1', text: '白开水 500ml', tag: 'water', mealType: 'snack', expect: '低/零热量' },
  { id: 'D2', text: '黑咖啡一杯', tag: 'beverage', mealType: 'breakfast' },
  // —— 极端/边界 ——
  { id: 'E1', text: '空气', tag: 'non-food', mealType: 'snack', expect: '友好拒答 or 0kcal' },
  { id: 'E2', text: '一大堆', tag: 'ambiguous', mealType: 'snack' },
  { id: 'E3', text: '我吃了点东西', tag: 'vague', mealType: 'lunch' },
];

// ==================== 工具 ====================

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: resp.status, body };
}

async function login(deviceId) {
  const { body } = await fetchJson(`${API_BASE}/api/app/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!body?.data?.token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.data.token;
}

async function patchProfile(token, declared) {
  const { status, body } = await fetchJson(
    `${API_BASE}/api/app/user-profile/declared`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(declared),
    },
  );
  if (status >= 400) throw new Error(`Patch profile failed (${status}): ${JSON.stringify(body)}`);
  return body;
}

async function analyzeText(token, text, mealType) {
  return fetchJson(`${API_BASE}/api/app/food/analyze-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, mealType }),
  });
}

function summarizeFoods(foods) {
  if (!Array.isArray(foods)) return null;
  return foods.map(f => ({
    name: f.name,
    cat: f.category,
    grams: f.estimatedWeightGrams,
    cal: f.calories,
    p: f.protein,
    f: f.fat,
    c: f.carbs,
    conf: f.confidence,
    matched: !f.estimated,
  }));
}

// ==================== 主流程 ====================

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const allResults = [];

  for (const profile of PROFILES) {
    console.log(`\n=== Profile: ${profile.label} (${profile.key}) ===`);
    const deviceId = `debug-batch-${profile.key}-fixed-v1`;
    const token = await login(deviceId);
    await patchProfile(token, profile.declared);
    console.log(`  ✓ profile patched`);

    for (const c of FOOD_CASES) {
      process.stdout.write(`  [${c.id}] ${c.text} ... `);
      const t0 = Date.now();
      let attempt = 0;
      let status, body;
      while (attempt < 3) {
        ({ status, body } = await analyzeText(token, c.text, c.mealType).catch(e => ({
          status: -1, body: { error: String(e) },
        })));
        if (status !== 429) break;
        await new Promise(r => setTimeout(r, 8000 * (attempt + 1)));
        attempt++;
      }
      const ms = Date.now() - t0;
      const data = body?.data || {};
      const rec = {
        profile: profile.key,
        case_id: c.id,
        text: c.text,
        tag: c.tag,
        expect: c.expect || null,
        mealType: c.mealType,
        http_status: status,
        success: body?.success === true,
        ms,
        // 关键字段抽取
        foods: summarizeFoods(data.foods),
        totals: data.totals
          ? {
              cal: data.totals.calories,
              p: data.totals.protein,
              f: data.totals.fat,
              c: data.totals.carbs,
            }
          : null,
        score_total: data.score?.total ?? data.score?.overall ?? null,
        decision: data.decision
          ? {
              recommendation: data.decision.recommendation,
              shouldEat: data.decision.shouldEat,
              reason: data.decision.reason,
              riskLevel: data.decision.riskLevel,
              advice: data.decision.advice,
              decisionFactors: (data.decision.decisionFactors || []).slice(0, 6),
              issues: (data.decision.issues || []).slice(0, 6).map(i => ({
                category: i.category, severity: i.severity, message: i.message,
              })),
            }
          : null,
        explanation_summary: data.explanation
          ? (typeof data.explanation === 'string'
              ? data.explanation.slice(0, 240)
              : (data.explanation.summary || data.explanation.text || JSON.stringify(data.explanation).slice(0, 240)))
          : null,
        error: status >= 400 ? body : null,
      };
      allResults.push(rec);
      console.log(`HTTP ${status} | ${ms}ms | foods=${(rec.foods || []).length} | rec=${rec.decision?.recommendation || '?'}`);
      // 节流：避开 ThrottlerException（默认 60req/min 等）
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 写文件
  const jsonPath = path.join(OUT_DIR, `results-${ts}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`\nWrote ${jsonPath}`);

  // 简单 Markdown 报告
  const md = renderMarkdown(allResults);
  const mdPath = path.join(OUT_DIR, `report-${ts}.md`);
  await fs.writeFile(mdPath, md, 'utf-8');
  console.log(`Wrote ${mdPath}`);
}

function renderMarkdown(results) {
  const byProfile = {};
  for (const r of results) (byProfile[r.profile] ||= []).push(r);
  const lines = [];
  lines.push(`# 批量测试报告  \n`);
  lines.push(`生成时间: ${new Date().toISOString()}  \n`);
  lines.push(`总用例: ${results.length}  \n`);
  const failed = results.filter(r => !r.success).length;
  lines.push(`失败用例: ${failed}  \n\n`);

  for (const [profile, list] of Object.entries(byProfile)) {
    lines.push(`## Profile: ${profile}\n`);
    lines.push(`| ID | text | foods (cat/g/cal/conf) | totals(cal/p/f/c) | score | decision | reason |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const r of list) {
      const foodsStr = (r.foods || [])
        .map(f => `${f.name}[${f.cat || '-'}/${f.grams || '-'}g/${f.cal || '-'}kcal/conf${f.conf}${f.matched ? '🟢' : '🟡'}]`)
        .join('<br>') || '-';
      const totalsStr = r.totals
        ? `${r.totals.cal}/${r.totals.p}/${r.totals.f}/${r.totals.c}`
        : '-';
      const decision = r.decision?.recommendation || (r.error ? `ERR ${r.http_status}` : '-');
      const reason = (r.decision?.reason || '').slice(0, 80);
      lines.push(`| ${r.case_id} | ${r.text} | ${foodsStr} | ${totalsStr} | ${r.score_total ?? '-'} | ${decision} | ${reason} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
