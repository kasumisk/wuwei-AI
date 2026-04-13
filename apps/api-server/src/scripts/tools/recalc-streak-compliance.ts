/**
 * 历史 streak/compliance 数据重算脚本
 *
 * 修复 B1/B2/B3 后，旧数据中的 streakDays、longestStreak、
 * healthyRecords、avgComplianceRate 可能失真。
 * 本脚本遍历所有用户，基于 DailySummary 重新计算。
 *
 * 用法:
 *   npx ts-node -r tsconfig-paths/register src/scripts/recalc-streak-compliance.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 判断某天是否达标: 有记录 && 热量在目标的 80%-110% */
function isCompliantDay(summary: {
  calorie_goal: number | null;
  total_calories: number;
}): boolean {
  const goal = summary.calorie_goal || 2000;
  const actual = summary.total_calories || 0;
  return actual > 0 && actual >= goal * 0.8 && actual <= goal * 1.1;
}

async function recalc() {
  try {
    console.log('Database connected');

    const profiles = await prisma.user_behavior_profiles.findMany();
    console.log(`Found ${profiles.length} behavior profiles to recalculate`);

    let updatedCount = 0;

    for (const profile of profiles) {
      const userId = profile.user_id;

      // 获取该用户所有 DailySummary，按日期升序
      const summaries = await prisma.daily_summaries.findMany({
        where: { user_id: userId },
        orderBy: { date: 'asc' },
      });

      if (summaries.length === 0) {
        // 无记录，全部归零
        await prisma.user_behavior_profiles.update({
          where: { id: profile.id },
          data: {
            streak_days: 0,
            longest_streak: 0,
            healthy_records: 0,
            avg_compliance_rate: 0,
            last_streak_date: null,
          },
        });
        updatedCount++;
        continue;
      }

      // ── 计算 streak（从最新日期倒推连续达标天数）──
      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;

      for (const summary of summaries) {
        if (isCompliantDay(summary)) {
          tempStreak++;
          if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
          }
        } else {
          tempStreak = 0;
        }
      }

      // 当前 streak: 从最后一天往回看连续达标天数
      const reversed = [...summaries].reverse();
      currentStreak = 0;
      for (const summary of reversed) {
        if (isCompliantDay(summary)) {
          currentStreak++;
        } else {
          break;
        }
      }

      // ── 近 30 天合规率 ──
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sinceDate = thirtyDaysAgo.toISOString().slice(0, 10);

      const recentSummaries = summaries.filter(
        (s) => s.date.toISOString().slice(0, 10) >= sinceDate,
      );
      const totalDays = recentSummaries.length;
      const healthyDays = recentSummaries.filter(isCompliantDay).length;

      // ── 更新 ──
      const avgComplianceRate =
        totalDays > 0 ? Number((healthyDays / totalDays).toFixed(2)) : 0;
      // lastStreakDate 设为最后一条记录的日期
      const lastStreakDate = summaries[summaries.length - 1].date
        .toISOString()
        .slice(0, 10);

      await prisma.user_behavior_profiles.update({
        where: { id: profile.id },
        data: {
          streak_days: currentStreak,
          longest_streak: longestStreak,
          healthy_records: healthyDays,
          avg_compliance_rate: avgComplianceRate,
          last_streak_date: lastStreakDate,
        },
      });
      updatedCount++;

      console.log(
        `  [${updatedCount}/${profiles.length}] userId=${userId} ` +
          `streak=${currentStreak} longest=${longestStreak} ` +
          `healthy=${healthyDays}/${totalDays} ` +
          `compliance=${avgComplianceRate}`,
      );
    }

    console.log(`\nRecalculation complete. Updated ${updatedCount} profiles.`);
    await prisma.$disconnect();
  } catch (error) {
    console.error('Recalculation failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

recalc();
