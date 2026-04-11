-- V6.5 Phase 1A: commonality_score 初始填充
-- 基于品类和 popularity 综合计算
-- 取值 0-100：0=极罕见, 50=一般, 100=日常必备

BEGIN;

-- 1. 基于品类 + popularity 综合计算
UPDATE foods SET commonality_score = CASE
  -- 日常主食类（米饭、面条、馒头等）
  WHEN category = 'grains' AND popularity >= 70 THEN 90
  WHEN category = 'grains' THEN 70

  -- 常见蔬菜
  WHEN category = 'vegetables' AND popularity >= 60 THEN 85
  WHEN category = 'vegetables' THEN 60

  -- 常见水果
  WHEN category = 'fruits' AND popularity >= 60 THEN 80
  WHEN category = 'fruits' THEN 55

  -- 常见肉类
  WHEN category = 'meat' AND name LIKE ANY(ARRAY['%鸡%', '%猪%', '%牛%', '%羊%']) THEN 85
  WHEN category = 'meat' THEN 40

  -- 海鲜（地域差异大）
  WHEN category = 'seafood' AND name LIKE ANY(ARRAY['%虾%', '%鱼%', '%蟹%']) THEN 65
  WHEN category = 'seafood' THEN 35

  -- 乳制品
  WHEN category = 'dairy' AND popularity >= 50 THEN 75
  WHEN category = 'dairy' THEN 50

  -- 豆类
  WHEN category = 'legumes' THEN 70

  -- 零食饮料
  WHEN category IN ('snacks', 'beverages') AND popularity >= 50 THEN 65
  WHEN category IN ('snacks', 'beverages') THEN 45

  -- 预制食品
  WHEN category IN ('prepared_foods', 'mixed_dishes') THEN 60

  -- 默认
  ELSE LEAST(popularity, 50)
END;

-- 2. 高级食材特别标注（手动降低 commonality）
UPDATE foods SET commonality_score = LEAST(commonality_score, 20)
WHERE name LIKE ANY(ARRAY[
  '%鸵鸟%', '%鹿肉%', '%鳄鱼%', '%蛇肉%',
  '%藜麦%', '%奇亚籽%', '%亚麻籽%',
  '%松露%', '%鹅肝%', '%鱼子酱%',
  '%牛油果%', '%羽衣甘蓝%'
]);

-- 3. 日常必备食材特别标注（手动提高 commonality）
UPDATE foods SET commonality_score = GREATEST(commonality_score, 90)
WHERE name LIKE ANY(ARRAY[
  '%米饭%', '%白米%', '%面条%', '%馒头%', '%面包%',
  '%鸡蛋%', '%豆腐%', '%牛奶%',
  '%白菜%', '%土豆%', '%番茄%', '%黄瓜%',
  '%苹果%', '%香蕉%'
]);

COMMIT;
