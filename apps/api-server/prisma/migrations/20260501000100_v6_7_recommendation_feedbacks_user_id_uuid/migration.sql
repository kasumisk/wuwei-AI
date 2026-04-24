-- v6.7 修复：recommendation_feedbacks.user_id 原为 VARCHAR，与所有 raw query 中 $1::uuid cast 不兼容，
-- 导致 feedback.service.ts 与 preference-profile.service.ts 在每次请求中抛 "operator does not exist: character varying = uuid"。
-- 已校验 25 行数据全部为合法 uuid 字符串，可安全 ALTER。

ALTER TABLE "recommendation_feedbacks"
    ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
