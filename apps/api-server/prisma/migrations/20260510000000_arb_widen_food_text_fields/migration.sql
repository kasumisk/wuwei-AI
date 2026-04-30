-- ARB-2026-05: 放宽 foods 主表文本字段长度，兼容 USDA 长名称与来源标识

ALTER TABLE "foods"
  ALTER COLUMN "name" TYPE VARCHAR(255),
  ALTER COLUMN "aliases" TYPE TEXT,
  ALTER COLUMN "sub_category" TYPE VARCHAR(255),
  ALTER COLUMN "food_group" TYPE VARCHAR(255),
  ALTER COLUMN "main_ingredient" TYPE VARCHAR(255),
  ALTER COLUMN "primary_source_id" TYPE VARCHAR(255);
