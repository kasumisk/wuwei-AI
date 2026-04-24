#!/usr/bin/env node
/**
 * 阶段 2：28 场景扰动矩阵（4 目标 × 7 维度）
 * 对每个 A 用户（01/02/03/04 对应 4 目标），按 7 个维度分别扰动 profile，
 * 清 daily_plans 缓存、调 runner 单用户模式、收集 issues，然后还原 profile。
 *
 * 输出：/tmp/matrix-result.json（28 行的 cell 表格）
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PSQL = 'psql postgresql://xiehaiji@localhost:5432/wuwei';

const USERS = [
  { tag: 'fat_loss-A',    phone: '13900010001', goal: 'fat_loss'    },
  { tag: 'muscle_gain-A', phone: '13900010002', goal: 'muscle_gain' },
  { tag: 'health-A',      phone: '13900010003', goal: 'health'      },
  { tag: 'habit-A',       phone: '13900010004', goal: 'habit'       },
];

// 每个扰动：columns 列表 + 新值 SQL 片段（同时记录原值列名以便 restore）
const DIMS = [
  {
    id: 'D1_lowBMI',
    desc: '低 BMI 扰动（体重 45kg）',
    cols: ['weight_kg'],
    apply: (_p) => `weight_kg = 45`,
  },
  {
    id: 'D2_active',
    desc: '高活动量（active）',
    cols: ['activity_level'],
    apply: () => `activity_level = 'active'`,
  },
  {
    id: 'D3_vegetarian',
    desc: '素食限制',
    cols: ['dietary_restrictions'],
    apply: () => `dietary_restrictions = '["vegetarian"]'::jsonb`,
  },
  {
    id: 'D4_diabetes',
    desc: '糖尿病健康状况',
    cols: ['health_conditions'],
    apply: () =>
      `health_conditions = '[{"condition":"diabetes_type2","severity":"moderate"}]'::jsonb`,
  },
  {
    id: 'D5_multiAllergen',
    desc: '多项过敏（花生/坚果/贝类/鸡蛋）',
    cols: ['allergens'],
    apply: () =>
      `allergens = '["peanut","tree_nut","shellfish","egg"]'::jsonb`,
  },
  {
    id: 'D6_beginnerLowBudget',
    desc: '零厨艺 + 低预算',
    cols: ['cooking_skill_level', 'budget_level', 'can_cook'],
    apply: () =>
      `cooking_skill_level = 'beginner', budget_level = 'low', can_cook = false`,
  },
  {
    id: 'D7_elderly',
    desc: '老年（出生 1955）',
    cols: ['birth_year'],
    apply: () => `birth_year = 1955`,
  },
];

function psqlExec(sql) {
  try {
    return execSync(`${PSQL} -At -c ${JSON.stringify(sql)}`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch (e) {
    throw new Error(`psql failed: ${e.stderr?.toString() || e.message}`);
  }
}

function saveOriginal(phone, cols) {
  const colList = cols.map((c) => `'${c}'::text, ${c}::text`).join(', ');
  const sql = `SELECT jsonb_build_object(${colList}) FROM user_profiles p JOIN app_users u ON u.id = p.user_id WHERE u.phone = '${phone}';`;
  const raw = psqlExec(sql).trim();
  return JSON.parse(raw);
}

function applyPerturb(phone, applySql) {
  psqlExec(
    `UPDATE user_profiles SET ${applySql} WHERE user_id = (SELECT id FROM app_users WHERE phone = '${phone}');`,
  );
}

function sqlLit(val) {
  // 所有字符串统一单引号 + 内部 ' → ''
  return `'${String(val).replace(/'/g, "''")}'`;
}
function restoreOriginal(phone, orig) {
  const sets = Object.entries(orig)
    .map(([col, val]) => {
      if (val === null || val === undefined) return `${col} = NULL`;
      if (typeof val === 'number') return `${col} = ${val}`;
      if (typeof val === 'boolean') return `${col} = ${val}`;
      // jsonb 列：JSON 字符串以 { 或 [ 开头
      if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
        return `${col} = ${sqlLit(val)}::jsonb`;
      }
      // 数值型以字符串返回（psql -At）
      if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) {
        return `${col} = ${val}`;
      }
      // 布尔（psql 返回 't' / 'f'）
      if (val === 't') return `${col} = true`;
      if (val === 'f') return `${col} = false`;
      return `${col} = ${sqlLit(val)}`;
    })
    .join(', ');
  psqlExec(
    `UPDATE user_profiles SET ${sets} WHERE user_id = (SELECT id FROM app_users WHERE phone = '${phone}');`,
  );
}

function clearDailyPlan(phone) {
  psqlExec(
    `DELETE FROM daily_plans WHERE date = CURRENT_DATE AND user_id = (SELECT id FROM app_users WHERE phone = '${phone}');`,
  );
}

function runRunner(tag) {
  const out = execSync(
    `node ${import.meta.dirname}/runner.mjs ${tag}`,
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 },
  ).toString();
  return JSON.parse(out).results[0];
}

const matrix = [];
let idx = 0;
for (const u of USERS) {
  for (const d of DIMS) {
    idx++;
    process.stderr.write(`[${idx}/28] ${u.tag} × ${d.id} (${d.desc})\n`);
    let orig;
    try {
      orig = saveOriginal(u.phone, d.cols);
      applyPerturb(u.phone, d.apply());
      clearDailyPlan(u.phone);
      const r = runRunner(u.tag);
      matrix.push({
        scenario: `${u.tag} × ${d.id}`,
        user: u.tag,
        dim: d.id,
        dimDesc: d.desc,
        goal: u.goal,
        issues: r.plan?.issues || r.errors || ['NO_PLAN'],
        kcalDev: r.plan?.kcalDev,
        proPP: r.plan?.macroDev?.proteinPP,
        fatPP: r.plan?.macroDev?.fatPP,
        carbsPP: r.plan?.macroDev?.carbsPP,
        foods: r.plan?.slots
          ? Object.fromEntries(
              Object.entries(r.plan.slots).map(([k, v]) => [k, v.foods]),
            )
          : {},
      });
    } catch (e) {
      matrix.push({
        scenario: `${u.tag} × ${d.id}`,
        user: u.tag,
        dim: d.id,
        error: String(e.message || e).slice(0, 200),
      });
    } finally {
      if (orig) {
        try {
          restoreOriginal(u.phone, orig);
        } catch (e) {
          process.stderr.write(`  RESTORE FAIL: ${e.message}\n`);
        }
      }
    }
  }
}

writeFileSync(
  '/tmp/matrix-result.json',
  JSON.stringify({ ts: new Date().toISOString(), matrix }, null, 2),
);
process.stderr.write(`\nWrote /tmp/matrix-result.json with ${matrix.length} cells\n`);
const issuesCells = matrix.filter((c) => (c.issues || []).length || c.error);
process.stderr.write(`Cells with issues/errors: ${issuesCells.length}/28\n`);
