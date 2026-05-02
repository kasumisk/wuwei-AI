/**
 * BUG-006 回归测试：PreferenceProfileService 在 JOIN foods × recommendation_feedbacks
 * 时必须先把 varchar 类型的 food_id 在子查询中转成 uuid，
 * 否则 PG 会报 42883 (operator does not exist: uuid = character varying)。
 *
 * 历史现象：runner 01 直接抛 PrismaClientUnknownRequestError，
 * profile-aggregator 整链路异常。
 *
 * 本测试通过 spy `$queryRawUnsafe` 捕获实际 SQL，锁定关键修复特征：
 *   1. 子查询里有 `food_id ~ '^[0-9a-fA-F-]{36}$'` regex 检查
 *   2. cast 成 `food_id::uuid`
 *   3. 外层 JOIN 走 `food_id_uuid`，不再直接 `fl.id = rf.food_id`
 *
 * 这样如果后续重构把这段 SQL 改回直接 JOIN 会立即被拦下。
 */

import { PreferenceProfileService } from '../../src/modules/diet/app/recommendation/profile/preference-profile.service';
import type { PrismaService } from '../../src/core/prisma/prisma.service';
import type { RedisCacheService } from '../../src/core/redis/redis-cache.service';

function makeRedisPassthrough(): RedisCacheService {
  return {
    buildKey: (...parts: string[]) => parts.join(':'),
    // 不缓存，直接执行 loader，便于捕获 prisma 调用
    getOrSet: async <T>(_key: string, _ttl: number, loader: () => Promise<T>) =>
      loader(),
  } as unknown as RedisCacheService;
}

describe('BUG-006 regression: buildPreferenceProfile SQL 防止 uuid=varchar JOIN', () => {
  it('生成的 SQL 必须把 food_id 在子查询里 sanitize 成 uuid 后再 JOIN', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]); // 空 → 走 empty 分支
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService;
    const redis = makeRedisPassthrough();

    const svc = new PreferenceProfileService(prisma, redis);
    await svc.getUserPreferenceProfile(
      '11111111-1111-1111-1111-111111111111',
    );

    expect(queryRawUnsafe).toHaveBeenCalled();
    const sql = queryRawUnsafe.mock.calls[0][0] as string;

    // 关键修复 1：正则过滤非 uuid 串
    expect(sql).toMatch(/food_id\s*~\s*'\^\[0-9a-fA-F-\]\{36\}\$'/);

    // 关键修复 2：显式 cast 成 uuid
    expect(sql).toMatch(/food_id::uuid/);

    // 关键修复 3：外层 JOIN 走 food_id_uuid，不能再直接 = rf.food_id
    expect(sql).toMatch(/fl\.id\s*=\s*rf\.food_id_uuid/);
    expect(sql).not.toMatch(/fl\.id\s*=\s*rf\.food_id\b/);
  });

  it('user_id 也必须 cast 成 uuid（防止反向漂移）', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService;
    const redis = makeRedisPassthrough();

    const svc = new PreferenceProfileService(prisma, redis);
    await svc.getUserPreferenceProfile('user-uuid');

    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toMatch(/user_id\s*=\s*\$1::uuid/);
  });

  it('feedback 行数 < 3 时返回空 profile（不会因为 sanitize 子查询误吞数据）', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      // 故意构造 2 行，验证 < 3 阈值仍然生效
      {
        action: 'accepted',
        category: 'protein',
        mainIngredient: 'chicken',
        foodGroup: 'meat',
        foodName: 'chicken-breast',
        createdAt: new Date(),
      },
      {
        action: 'rejected',
        category: 'protein',
        mainIngredient: 'beef',
        foodGroup: 'meat',
        foodName: 'beef-steak',
        createdAt: new Date(),
      },
    ]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService;
    const redis = makeRedisPassthrough();

    const svc = new PreferenceProfileService(prisma, redis);
    const profile = await svc.getUserPreferenceProfile('uid');

    expect(profile.categoryWeights).toEqual({});
    expect(profile.ingredientWeights).toEqual({});
    expect(profile.foodGroupWeights).toEqual({});
    expect(profile.foodNameWeights).toEqual({});
  });
});
