-- ARB-2026-04: 合并 feedback_details → recommendation_feedbacks.details (JSONB)
--
-- 变更说明：
--   FeedbackDetails 表只被一个 service 引用，且始终与 RecommendationFeedbacks 1:1
--   写入（有 ratings 或 implicitSignals 时才写 details 行）。
--   合并后消除一次 JOIN / 一次 INSERT，简化代码路径。
--
-- 执行顺序：
--   1. 主表加列
--   2. 回填存量数据（JSONB 聚合）
--   3. DROP 子表

-- 1. recommendation_feedbacks 新增 details JSONB 列
ALTER TABLE recommendation_feedbacks
  ADD COLUMN IF NOT EXISTS details JSONB;

-- 2. 回填：将 feedback_details 中的数据合并进主表
UPDATE recommendation_feedbacks rf
SET details = (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'tasteRating',    d.taste_rating,
    'portionRating',  d.portion_rating,
    'priceRating',    d.price_rating,
    'timingRating',   d.timing_rating,
    'comment',        d.comment,
    'dwellTimeMs',    d.dwell_time_ms,
    'detailExpanded', d.detail_expanded
  ))
  FROM feedback_details d
  WHERE d.feedback_id = rf.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM feedback_details d WHERE d.feedback_id = rf.id
);

-- 3. 删除旧表（CASCADE 自动清理索引/约束）
DROP TABLE IF EXISTS feedback_details CASCADE;
