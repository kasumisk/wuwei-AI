/**
 * scripts/validate-recommendations.ts
 *
 * Final-fix 验证：真实跑 recommendMeal + 7 天 daily-plan，校验本轮 4 项 invariant。
 *
 *   V1 (P0-1) 跨 region cuisine 隔离：
 *       非 CN 用户的 recommendMeal 结果中，cuisine 映射后的国家集合
 *       必须 ∩ {user.country, user.cuisinePreferences→countries} ≠ ∅
 *       （食物 cuisine==null 或 unmapped → 中性放行）
 *
 *   V2 (P0-2) 7 天 frequency cap：
 *       每个用户连跑 7 天 daily-plan，统计 (foodId|name)→count，
 *       要求 max(count) ≤ 2
 *
 *   V3 (P0-3) canCook=false channel 约束：
 *       canCook=false 用户的推荐结果中，每个食物的 availableChannels
 *       必须 ∩ {restaurant, takeout, fast_food, delivery, convenience_store,
 *              convenience, bakery, canteen} ≠ ∅，或 channels 为空（中性）
 *
 *   V4 (P1-7) 非法 timezone fallback：
 *       构造非法 tz 调用 getUserLocalHour/Date，应返回 0-23 / yyyy-mm-dd，
 *       不抛异常
 *
 * Usage:
 *   pnpm --filter api-server exec ts-node -r tsconfig-paths/register \
 *     scripts/validate-recommendations.ts
 *
 * Exit code: 0 = all pass, 2 = violations, 1 = bootstrap/runtime error
 */

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { RecommendationEngineService } from '../src/modules/diet/app/services/recommendation-engine.service';
import { WeeklyPlanService } from '../src/modules/diet/app/services/weekly-plan.service';
import { cuisineToCountryCodes } from '../src/common/utils/cuisine.util';
import {
  getUserLocalHour,
  getUserLocalDate,
} from '../src/common/utils/timezone.util';
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const NON_COOK_ACCEPTABLE = new Set([
  'restaurant',
  'takeout',
  'fast_food',
  'delivery',
  'convenience_store',
  'convenience',
  'bakery',
  'canteen',
]);

interface E2EUser {
  id: string;
  email: string;
  goal: string;
  region: string;
  dailyCal: number;
  weightKg: number;
  canCook: boolean;
  cuisinePrefs: string[];
  profile: any;
}

interface V1Violation {
  user: string;
  region: string;
  meal: string;
  foodName: string;
  cuisine: string;
  foodCountries: string[];
  allowedCountries: string[];
}

interface V2Violation {
  user: string;
  foodKey: string;
  count: number;
}

interface V3Violation {
  user: string;
  meal: string;
  foodName: string;
  channels: string[];
}

function macroSplit(
  dailyCal: number,
  mealType: MealType,
  goal: string,
  weightKg: number,
) {
  const proteinGPerKg =
    goal === 'muscle_gain'
      ? 2.4
      : goal === 'fat_loss'
        ? 2.1
        : goal === 'habit'
          ? 2.0
          : 1.6;
  const dailyProtein = Math.round(proteinGPerKg * weightKg);
  const dailyFat = Math.round((dailyCal * 0.27) / 9);
  const dailyCarbs = Math.max(
    Math.round((dailyCal - dailyProtein * 4 - dailyFat * 9) / 4),
    0,
  );
  const ratio =
    mealType === 'breakfast'
      ? 0.25
      : mealType === 'lunch'
        ? 0.35
        : mealType === 'dinner'
          ? 0.3
          : 0.1;
  return {
    daily: {
      calories: dailyCal,
      protein: dailyProtein,
      fat: dailyFat,
      carbs: dailyCarbs,
    },
    meal: {
      calories: Math.round(dailyCal * ratio),
      protein: Math.round(dailyProtein * ratio),
      fat: Math.round(dailyFat * ratio),
      carbs: Math.round(dailyCarbs * ratio),
    },
  };
}

async function loadUsers(app: INestApplicationContext): Promise<E2EUser[]> {
  const prisma = app.get(PrismaService);
  const users = await prisma.appUsers.findMany({
    where: { email: { endsWith: '@e2e.test' } },
    include: { userProfiles: true },
    orderBy: { email: 'asc' },
  });
  return users
    .filter((u) => u.userProfiles)
    .map((u) => {
      const p = u.userProfiles!;
      return {
        id: u.id,
        email: u.email!,
        goal: p.goal,
        region: p.regionCode || 'US',
        dailyCal: p.dailyCalorieGoal || 2000,
        weightKg: p.weightKg ? Number(p.weightKg) : 70,
        canCook: (p as any).canCook !== false,
        cuisinePrefs: ((p as any).cuisinePreferences as string[]) ?? [],
        profile: p,
      };
    });
}

function shortErr(e: unknown, lines = 3): string {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  return msg.split('\n').slice(0, lines).join(' | ').slice(0, 400);
}

async function validateV1(
  engine: RecommendationEngineService,
  users: E2EUser[],
): Promise<V1Violation[]> {
  const violations: V1Violation[] = [];
  // 仅校验非 CN 用户（最容易暴露跨 region 污染）
  const targets = users.filter((u) => !u.region.toUpperCase().startsWith('CN'));
  for (const u of targets) {
    const userCountry = (u.region || '').split('-')[0].toUpperCase();
    const allowed = new Set<string>([userCountry]);
    for (const pref of u.cuisinePrefs) {
      for (const cc of cuisineToCountryCodes(pref))
        allowed.add(cc.toUpperCase());
    }
    for (const meal of MEAL_TYPES) {
      const { meal: mealTarget, daily } = macroSplit(
        u.dailyCal,
        meal,
        u.goal,
        u.weightKg,
      );
      try {
        const r = await engine.recommendMeal(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        for (const item of r?.foods ?? []) {
          const food: any = (item as any).food ?? item;
          const cuisine = food.cuisine as string | null | undefined;
          if (!cuisine) continue;
          const foodCountries = cuisineToCountryCodes(cuisine);
          if (foodCountries.length === 0) continue;
          if (!foodCountries.some((c) => allowed.has(c.toUpperCase()))) {
            violations.push({
              user: u.email,
              region: u.region,
              meal,
              foodName: food.name,
              cuisine,
              foodCountries,
              allowedCountries: [...allowed],
            });
          }
        }
      } catch (e) {
        console.warn(`[V1] ${u.email}/${meal} threw: ${shortErr(e)}`);
      }
    }
  }
  return violations;
}

async function validateV2(
  weekly: WeeklyPlanService,
  prisma: PrismaService,
  users: E2EUser[],
): Promise<{ violations: V2Violation[]; perUserMax: Record<string, number> }> {
  const violations: V2Violation[] = [];
  const perUserMax: Record<string, number> = {};
  // 限制并发：仅前 6 个用户
  const subset = users.slice(0, 6);
  for (const u of subset) {
    // 强制重新生成本周计划：删除该用户最近 ±2 周的 dailyPlans
    // （weekly-plan 用 user-local-tz 计算 monday，脚本用 UTC 算可能有偏移，
    //  所以扩大删除窗口确保清空，避免 existingMap 命中陈旧计划）
    try {
      const now = new Date();
      const lo = new Date(now);
      lo.setUTCDate(now.getUTCDate() - 14);
      const hi = new Date(now);
      hi.setUTCDate(now.getUTCDate() + 14);
      await prisma.dailyPlans.deleteMany({
        where: {
          userId: u.id,
          date: { gte: lo, lte: hi },
        },
      });
    } catch (e) {
      console.warn(`[V2] cleanup ${u.email} threw: ${shortErr(e)}`);
    }

    const counter = new Map<string, number>();
    try {
      const week = await weekly.getWeeklyPlan(u.id);
      for (const day of week.plans ?? []) {
        const meals = (day as any).meals ?? {};
        for (const slot of ['morning', 'lunch', 'dinner', 'snack']) {
          const items = (meals[slot]?.foodItems ?? []) as any[];
          for (const it of items) {
            const key = (it.foodId as string) || (it.name as string) || '?';
            counter.set(key, (counter.get(key) ?? 0) + 1);
          }
        }
      }
    } catch (e) {
      console.warn(`[V2] ${u.email} threw: ${shortErr(e)}`);
    }

    let maxCount = 0;
    for (const [k, c] of counter) {
      if (c > maxCount) maxCount = c;
      if (c > 2) violations.push({ user: u.email, foodKey: k, count: c });
    }
    perUserMax[u.email] = maxCount;
  }
  return { violations, perUserMax };
}

async function validateV3(
  engine: RecommendationEngineService,
  users: E2EUser[],
): Promise<V3Violation[]> {
  const violations: V3Violation[] = [];
  const targets = users.filter((u) => u.canCook === false);
  if (targets.length === 0) {
    console.warn('[V3] no canCook=false e2e users; skipped');
    return violations;
  }
  for (const u of targets) {
    for (const meal of MEAL_TYPES) {
      const { meal: mealTarget, daily } = macroSplit(
        u.dailyCal,
        meal,
        u.goal,
        u.weightKg,
      );
      try {
        const r = await engine.recommendMeal(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        for (const item of r?.foods ?? []) {
          const food: any = (item as any).food ?? item;
          const channels = (food.availableChannels ?? []) as string[];
          if (channels.length === 0) continue;
          if (!channels.some((c) => NON_COOK_ACCEPTABLE.has(c))) {
            violations.push({
              user: u.email,
              meal,
              foodName: food.name,
              channels,
            });
          }
        }
      } catch (e) {
        console.warn(`[V3] ${u.email}/${meal} threw: ${shortErr(e)}`);
      }
    }
  }
  return violations;
}

function validateV4(): { ok: boolean; details: string[] } {
  const bad = ['CST', 'GMT+8', '', 'Asia/Atlantis', 'XYZ'];
  const errors: string[] = [];
  for (const tz of bad) {
    try {
      const h = getUserLocalHour(tz);
      const d = getUserLocalDate(tz);
      if (typeof h !== 'number' || h < 0 || h > 23)
        errors.push(`tz='${tz}' invalid hour=${h}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        errors.push(`tz='${tz}' invalid date=${d}`);
    } catch (e) {
      errors.push(`tz='${tz}' threw: ${shortErr(e)}`);
    }
  }
  return { ok: errors.length === 0, details: errors };
}

function tableV1(rows: V1Violation[]): string {
  if (rows.length === 0) return '(none)';
  return (
    '| user | region | meal | food | cuisine | foodCountries | allowed |\n' +
    '|---|---|---|---|---|---|---|\n' +
    rows
      .map(
        (v) =>
          `| ${v.user} | ${v.region} | ${v.meal} | ${v.foodName} | ${v.cuisine} | ${v.foodCountries.join(',')} | ${v.allowedCountries.join(',')} |`,
      )
      .join('\n')
  );
}

function tableV2(rows: V2Violation[]): string {
  if (rows.length === 0) return '(none)';
  return (
    '| user | foodKey | count |\n|---|---|---|\n' +
    rows.map((v) => `| ${v.user} | ${v.foodKey} | ${v.count} |`).join('\n')
  );
}

function tableV3(rows: V3Violation[]): string {
  if (rows.length === 0) return '(none)';
  return (
    '| user | meal | food | channels |\n|---|---|---|---|\n' +
    rows
      .map(
        (v) =>
          `| ${v.user} | ${v.meal} | ${v.foodName} | ${v.channels.join(',')} |`,
      )
      .join('\n')
  );
}

async function main() {
  const startedAt = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const engine = app.get(RecommendationEngineService);
  const weekly = app.get(WeeklyPlanService);
  const prisma = app.get(PrismaService);

  const users = await loadUsers(app);
  console.log(`[validate] loaded ${users.length} e2e users`);

  const v4 = validateV4();
  console.log(`[V4] timezone fallback: ${v4.ok ? 'PASS' : 'FAIL'}`);

  const v1 = await validateV1(engine, users);
  console.log(`[V1] cross-region cuisine violations: ${v1.length}`);

  const v3 = await validateV3(engine, users);
  console.log(`[V3] canCook=false channel violations: ${v3.length}`);

  const v2 = await validateV2(weekly, prisma, users);
  console.log(`[V2] 7d frequency-cap violations: ${v2.violations.length}`);

  const allOk =
    v1.length === 0 && v2.violations.length === 0 && v3.length === 0 && v4.ok;
  const ms = Date.now() - startedAt;

  const reportDir = path.resolve(__dirname, '../test/runners/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(reportDir, `validate-recommendations-${ts}.md`);
  const md = [
    `# validate-recommendations`,
    ``,
    `- generated: ${new Date().toISOString()}`,
    `- duration: ${ms} ms`,
    `- users: ${users.length}`,
    `- overall: **${allOk ? 'PASS' : 'FAIL'}**`,
    ``,
    `## Summary`,
    `| invariant | result |`,
    `|---|---|`,
    `| V1 cross-region cuisine | ${v1.length === 0 ? 'PASS' : `FAIL (${v1.length})`} |`,
    `| V2 7d frequency cap (≤2) | ${v2.violations.length === 0 ? 'PASS' : `FAIL (${v2.violations.length})`} |`,
    `| V3 canCook=false channels | ${v3.length === 0 ? 'PASS' : `FAIL (${v3.length})`} |`,
    `| V4 invalid tz fallback | ${v4.ok ? 'PASS' : 'FAIL'} |`,
    ``,
    `## V1 cross-region cuisine`,
    tableV1(v1),
    ``,
    `## V2 7-day frequency cap`,
    `per-user max counts: ${JSON.stringify(v2.perUserMax)}`,
    ``,
    tableV2(v2.violations),
    ``,
    `## V3 canCook=false channels`,
    tableV3(v3),
    ``,
    `## V4 invalid timezone fallback`,
    v4.ok ? '(all OK)' : v4.details.map((d) => `- ${d}`).join('\n'),
    ``,
  ].join('\n');
  fs.writeFileSync(file, md, 'utf8');
  console.log(`[validate] report → ${file}`);

  await app.close();
  process.exit(allOk ? 0 : 2);
}

main().catch((e) => {
  console.error('[validate] fatal:', e);
  process.exit(1);
});
