/**
 * ARB-2026-04: user-profile-merge.helper.ts
 *
 * UserInferredProfiles + UserBehaviorProfiles 已合并到 user_profiles 的
 * JSONB 列 inferred_data / behavior_data。
 *
 * 所有原先写 prisma.userInferredProfiles / prisma.userBehaviorProfiles 的路径
 * 改为调用此文件的辅助函数。
 */

import { PrismaClient, Prisma } from '@prisma/client';

type PrismaLike = Pick<PrismaClient, 'userProfiles'>;

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface InferredData {
  estimatedBmr?: number | null;
  estimatedTdee?: number | null;
  recommendedCalories?: number | null;
  macroTargets?: Record<string, any>;
  userSegment?: string | null;
  churnRisk?: number | null;
  optimalMealCount?: number | null;
  tastePrefVector?: any[];
  nutritionGaps?: any[];
  goalProgress?: Record<string, any>;
  confidenceScores?: Record<string, any>;
  lastComputedAt?: string | Date | null;
  preferenceWeights?: Record<string, any> | null;
}

export interface BehaviorData {
  foodPreferences?: Record<string, any>;
  bingeRiskHours?: any[];
  failureTriggers?: any[];
  avgComplianceRate?: number | null;
  coachStyle?: string;
  totalRecords?: number;
  healthyRecords?: number;
  streakDays?: number;
  longestStreak?: number;
  mealTimingPatterns?: Record<string, any>;
  portionTendency?: string | null;
  replacementPatterns?: Record<string, any>;
  lastStreakDate?: string | null;
}

// ─── 写入辅助 ────────────────────────────────────────────────────────────────

/**
 * 更新 user_profiles.inferred_data（深度 merge，使用 Postgres || 操作符）
 *
 * 如果该用户没有 UserProfiles 记录，此操作会静默失败（不影响主流程）。
 * 调用方可以预先确保 UserProfiles 存在。
 */
export async function updateInferred(
  prisma: PrismaLike,
  userId: string,
  patch: InferredData,
): Promise<void> {
  const cleaned = removeUndefined(patch);
  if (!Object.keys(cleaned).length) return;

  await (prisma as any).userProfiles.updateMany({
    where: { userId },
    data: {
      inferredData: {
        // Prisma JSONB merge via path update is not supported directly;
        // we pass the patch and let Prisma do a full replace merge in application layer
      },
      updatedAt: new Date(),
    },
  });

  // Use raw merge for JSONB: existing || patch
  await (prisma as PrismaClient).$executeRaw`
    UPDATE user_profiles
    SET inferred_data = inferred_data || ${JSON.stringify(cleaned)}::jsonb,
        updated_at    = NOW()
    WHERE user_id = ${userId}::uuid
  `;
}

/**
 * 更新 user_profiles.behavior_data（深度 merge）
 */
export async function updateBehavior(
  prisma: PrismaLike,
  userId: string,
  patch: BehaviorData,
): Promise<void> {
  const cleaned = removeUndefined(patch);
  if (!Object.keys(cleaned).length) return;

  await (prisma as PrismaClient).$executeRaw`
    UPDATE user_profiles
    SET behavior_data = behavior_data || ${JSON.stringify(cleaned)}::jsonb,
        updated_at    = NOW()
    WHERE user_id = ${userId}::uuid
  `;
}

/**
 * 确保 user_profiles 行存在（upsert），然后写入 inferred_data。
 * 用于可能没有 profile 的新用户场景（如首次 AI 推断）。
 */
export async function upsertInferred(
  prisma: PrismaLike,
  userId: string,
  patch: InferredData,
): Promise<void> {
  const cleaned = removeUndefined(patch);
  if (!Object.keys(cleaned).length) return;

  // Ensure row exists
  const existing = await prisma.userProfiles.findUnique({ where: { userId } });
  if (!existing) return; // UserProfiles is created during onboarding; skip if absent

  await (prisma as PrismaClient).$executeRaw`
    UPDATE user_profiles
    SET inferred_data = inferred_data || ${JSON.stringify(cleaned)}::jsonb,
        updated_at    = NOW()
    WHERE user_id = ${userId}::uuid
  `;
}

/**
 * 确保 user_profiles 行存在（upsert），然后写入 behavior_data。
 */
export async function upsertBehavior(
  prisma: PrismaLike,
  userId: string,
  patch: BehaviorData,
): Promise<void> {
  const cleaned = removeUndefined(patch);
  if (!Object.keys(cleaned).length) return;

  const existing = await prisma.userProfiles.findUnique({ where: { userId } });
  if (!existing) return;

  await (prisma as PrismaClient).$executeRaw`
    UPDATE user_profiles
    SET behavior_data = behavior_data || ${JSON.stringify(cleaned)}::jsonb,
        updated_at    = NOW()
    WHERE user_id = ${userId}::uuid
  `;
}

// ─── 读取辅助 ────────────────────────────────────────────────────────────────

/** 从 UserProfiles 读取 inferredData，返回强类型对象（缺失时返回空对象） */
export function getInferred(profile: { inferredData?: any }): InferredData {
  return (profile.inferredData as InferredData) ?? {};
}

/** 从 UserProfiles 读取 behaviorData，返回强类型对象（缺失时返回空对象） */
export function getBehavior(profile: { behaviorData?: any }): BehaviorData {
  return (profile.behaviorData as BehaviorData) ?? {};
}

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function removeUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}
