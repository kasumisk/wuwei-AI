-- V7.8: 合并 exercise_intensity 到 exercise_profile.intensity
-- exercise_intensity (VARCHAR(20)) 与 activity_level 语义重叠，
-- 仅 10 处代码使用，将其值迁移到 exercise_profile JSON 后删除独立列。

-- Step 1: 若 exercise_intensity 列存在，将其值写入 exercise_profile.intensity
-- 使用 DO $$ 块做列存在性检查，避免列已缺失时报错（幂等安全）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles'
      AND column_name = 'exercise_intensity'
  ) THEN
    UPDATE user_profiles
    SET exercise_profile = jsonb_set(
      COALESCE(exercise_profile::jsonb, '{}'::jsonb),
      '{intensity}',
      to_jsonb(exercise_intensity)
    )
    WHERE exercise_intensity IS NOT NULL
      AND exercise_intensity != '';
  END IF;
END $$;

-- Step 2: 删除 exercise_intensity 列（IF EXISTS 保证幂等）
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "exercise_intensity";
