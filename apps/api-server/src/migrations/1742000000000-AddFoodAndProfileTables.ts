import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFoodAndProfileTables1742000000000 implements MigrationInterface {
  name = 'AddFoodAndProfileTables1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 创建 meal_type 枚举
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "meal_type_enum" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. 创建 record_source_enum 枚举
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "record_source_enum" AS ENUM ('screenshot', 'camera', 'manual');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 3. 创建 activity_level_enum 枚举
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "activity_level_enum" AS ENUM ('sedentary', 'light', 'moderate', 'active');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 4. 创建 food_records 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_records" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
        "image_url" VARCHAR(500),
        "source" "record_source_enum" NOT NULL DEFAULT 'screenshot',
        "recognized_text" TEXT,
        "foods" JSONB NOT NULL DEFAULT '[]',
        "total_calories" INT NOT NULL DEFAULT 0,
        "meal_type" "meal_type_enum" DEFAULT 'lunch',
        "advice" TEXT,
        "is_healthy" BOOLEAN,
        "recorded_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_food_records_user_recorded"
        ON "food_records"("user_id", "recorded_at" DESC);
    `);

    // 5. 创建 daily_summaries 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_summaries" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
        "date" DATE NOT NULL,
        "total_calories" INT DEFAULT 0,
        "calorie_goal" INT,
        "meal_count" INT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("user_id", "date")
      );
    `);

    // 6. 创建 user_profiles 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_profiles" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL UNIQUE REFERENCES "app_users"("id") ON DELETE CASCADE,
        "gender" VARCHAR(10),
        "birth_year" INT,
        "height_cm" DECIMAL(5,1),
        "weight_kg" DECIMAL(5,1),
        "target_weight_kg" DECIMAL(5,1),
        "activity_level" "activity_level_enum" DEFAULT 'light',
        "daily_calorie_goal" INT,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profiles";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_summaries";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "food_records";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "activity_level_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "record_source_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "meal_type_enum";`);
  }
}
