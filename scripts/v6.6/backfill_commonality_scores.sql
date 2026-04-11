-- V6.6 Phase 1-A: foods.commonality_score 数据回填
-- 使用 category + popularity_score 的分桶逻辑（比 V6.6 文档中的简单映射更精细）
-- 此脚本在 prisma migrate deploy 后手动执行，或在 CI 中作为 post-migrate hook 运行。
--
-- 逻辑来源: scripts/v6.5/fill_commonality_scores.sql（更精细版本）
-- 最终效果: foods 表中每行的 commonality_score 将根据 category 和 popularity_score 计算出
--           一个 0-100 的大众化评分，并确保仅对当前仍为默认值(50)的行进行更新（幂等）。

BEGIN;

-- Step 1: 根据 category + popularity_score 分桶计算大众化评分
-- 分桶规则（越接近日常饮食越高）：
--   grain/vegetable/fruit/egg/dairy  → 基准分 75
--   meat/seafood/bean                → 基准分 60
--   snack/beverage/condiment         → 基准分 45
--   supplement/specialty/other       → 基准分 25
-- 然后根据 popularity_score 上下浮动 ±25，最终 CLAMP 到 [0, 100]
UPDATE foods
SET commonality_score = GREATEST(0, LEAST(100,
    CASE
        WHEN category IN ('grain', 'vegetable', 'fruit', 'egg', 'dairy')
            THEN 75 + ROUND((COALESCE(popularity_score, 50) - 50) * 0.5)::INTEGER
        WHEN category IN ('meat', 'seafood', 'bean', 'legume')
            THEN 60 + ROUND((COALESCE(popularity_score, 50) - 50) * 0.5)::INTEGER
        WHEN category IN ('snack', 'beverage', 'condiment', 'sauce')
            THEN 45 + ROUND((COALESCE(popularity_score, 50) - 50) * 0.5)::INTEGER
        WHEN category IN ('supplement', 'specialty', 'traditional')
            THEN 25 + ROUND((COALESCE(popularity_score, 50) - 50) * 0.4)::INTEGER
        ELSE
            -- 未知分类：直接用 popularity_score，默认 50
            COALESCE(popularity_score, 50)
    END
))
WHERE commonality_score = 50; -- 仅回填默认值，避免覆盖已有数据（幂等保护）

-- Step 2: 统计回填结果（用于验证）
DO $$
DECLARE
    v_total    INTEGER;
    v_low      INTEGER;  -- [0, 30)
    v_mid      INTEGER;  -- [30, 70)
    v_high     INTEGER;  -- [70, 100]
BEGIN
    SELECT COUNT(*) INTO v_total FROM foods;
    SELECT COUNT(*) INTO v_low   FROM foods WHERE commonality_score < 30;
    SELECT COUNT(*) INTO v_mid   FROM foods WHERE commonality_score BETWEEN 30 AND 69;
    SELECT COUNT(*) INTO v_high  FROM foods WHERE commonality_score >= 70;

    RAISE NOTICE 'commonality_score backfill complete: total=%, low(0-29)=%, mid(30-69)=%, high(70-100)=%',
        v_total, v_low, v_mid, v_high;
END
$$;

COMMIT;
