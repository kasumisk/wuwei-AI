import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 全球化食物数据库升级迁移
 *
 * 目标：将 foods 表从初始版本升级到设计文档 v1.0 完整版
 * 同时创建 5 张关联表: food_translations, food_sources, food_change_logs, food_conflicts, food_regional_info
 *
 * 主要操作：
 * 1. RENAME 旧列名 → 新列名 (calories_per_100g → calories, etc.)
 * 2. ALTER 列类型 (INT → DECIMAL)
 * 3. ADD 新列 (~25+ 列)
 * 4. CREATE 5 张关联表
 * 5. ADD GIN 索引 (tags, meal_types, allergens)
 * 6. UPDATE 已有数据的 category 从中文到英文
 */
export class GlobalFoodDatabaseUpgrade1753000000000 implements MigrationInterface {
  name = 'GlobalFoodDatabaseUpgrade1753000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ══════════════════════════════════════════════════════════════
    // 1. RENAME 旧列名 → 新列名
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'calories_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'calories'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "calories_per_100g" TO "calories";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'protein_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'protein'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "protein_per_100g" TO "protein";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'fat_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'fat'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "fat_per_100g" TO "fat";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'carbs_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'carbs'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "carbs_per_100g" TO "carbs";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'fiber_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'fiber'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "fiber_per_100g" TO "fiber";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'sugar_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'sugar'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "sugar_per_100g" TO "sugar";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'sodium_per_100g'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'sodium'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "sodium_per_100g" TO "sodium";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'source'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'primary_source'
        ) THEN
          ALTER TABLE foods RENAME COLUMN "source" TO "primary_source";
        END IF;
      END $$;
    `);

    // ══════════════════════════════════════════════════════════════
    // 2. ALTER 列类型 (精度调整)
    // ══════════════════════════════════════════════════════════════
    await queryRunner
      .query(
        `
      ALTER TABLE foods
        ALTER COLUMN "calories" TYPE DECIMAL(7,1) USING "calories"::DECIMAL(7,1),
        ALTER COLUMN "protein" TYPE DECIMAL(6,1) USING "protein"::DECIMAL(6,1),
        ALTER COLUMN "fat" TYPE DECIMAL(6,1) USING "fat"::DECIMAL(6,1),
        ALTER COLUMN "carbs" TYPE DECIMAL(6,1) USING "carbs"::DECIMAL(6,1),
        ALTER COLUMN "quality_score" TYPE DECIMAL(3,1) USING "quality_score"::DECIMAL(3,1),
        ALTER COLUMN "satiety_score" TYPE DECIMAL(3,1) USING "satiety_score"::DECIMAL(3,1)
    `,
      )
      .catch(() => {});

    // ══════════════════════════════════════════════════════════════
    // 3. ADD 新列到 foods 表
    // ══════════════════════════════════════════════════════════════

    // 基础标识
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "code" VARCHAR(50),
        ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(50),
        ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS "food_group" VARCHAR(30)
    `);

    // 宏量营养素 (新增)
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "saturated_fat" DECIMAL(5,1),
        ADD COLUMN IF NOT EXISTS "trans_fat" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "cholesterol" DECIMAL(6,1)
    `);

    // 微量营养素
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "potassium" DECIMAL(7,1),
        ADD COLUMN IF NOT EXISTS "calcium" DECIMAL(7,1),
        ADD COLUMN IF NOT EXISTS "iron" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "vitamin_a" DECIMAL(7,1),
        ADD COLUMN IF NOT EXISTS "vitamin_c" DECIMAL(6,1),
        ADD COLUMN IF NOT EXISTS "vitamin_d" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "vitamin_e" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "vitamin_b12" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "folate" DECIMAL(6,1),
        ADD COLUMN IF NOT EXISTS "zinc" DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS "magnesium" DECIMAL(6,1)
    `);

    // 健康评估
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "glycemic_load" DECIMAL(5,1),
        ADD COLUMN IF NOT EXISTS "processing_level" INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "allergens" JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "nutrient_density" DECIMAL(5,1)
    `);

    // 多样性 & 搭配
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "compatibility" JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "common_portions" JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    // 媒体
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "thumbnail_url" VARCHAR(500)
    `);

    // 数据溯源
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "primary_source_id" VARCHAR(100),
        ADD COLUMN IF NOT EXISTS "data_version" INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "verified_by" VARCHAR(100),
        ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP
    `);

    // 搜索优化
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS "popularity" INT NOT NULL DEFAULT 0
    `);

    // ══════════════════════════════════════════════════════════════
    // 4. 设置 code 唯一约束 & 生成已有数据的 code
    // ══════════════════════════════════════════════════════════════
    // 为已有数据生成 code (FOOD_CN_XXXX)
    await queryRunner
      .query(
        `
      UPDATE foods SET code = 'FOOD_CN_' || LPAD(ROW_NUMBER::TEXT, 4, '0')
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS ROW_NUMBER
        FROM foods WHERE code IS NULL
      ) sub
      WHERE foods.id = sub.id
    `,
      )
      .catch(() => {});

    // 设置 code NOT NULL + UNIQUE
    await queryRunner
      .query(
        `
      ALTER TABLE foods ALTER COLUMN "code" SET NOT NULL
    `,
      )
      .catch(() => {});

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_foods_code_unique" ON foods ("code")
    `);

    // ══════════════════════════════════════════════════════════════
    // 5. 中文分类 → 英文标准编码 (已有数据迁移)
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      UPDATE foods SET category = CASE category
        WHEN '主食' THEN 'grain'
        WHEN '肉类' THEN 'protein'
        WHEN '蔬菜' THEN 'veggie'
        WHEN '豆制品' THEN 'protein'
        WHEN '水果' THEN 'fruit'
        WHEN '汤类' THEN 'composite'
        WHEN '饮品' THEN 'beverage'
        WHEN '零食' THEN 'snack'
        WHEN '快餐' THEN 'composite'
        WHEN '调味料' THEN 'condiment'
        ELSE category
      END
      WHERE category IN ('主食','肉类','蔬菜','豆制品','水果','汤类','饮品','零食','快餐','调味料')
    `);

    // 状态：将已有数据设为 active
    await queryRunner.query(`
      UPDATE foods SET status = 'active' WHERE status = 'draft'
    `);

    // ══════════════════════════════════════════════════════════════
    // 6. GIN 索引
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_tags_gin" ON foods USING GIN ("tags")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_meal_types_gin" ON foods USING GIN ("meal_types")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_allergens_gin" ON foods USING GIN ("allergens")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_status" ON foods ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_barcode" ON foods ("barcode") WHERE barcode IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foods_primary_source" ON foods ("primary_source")`,
    );

    // ══════════════════════════════════════════════════════════════
    // 7. 创建 food_translations 表
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_translations" (
        "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "food_id"        UUID         NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        "locale"         VARCHAR(10)  NOT NULL,
        "name"           VARCHAR(200) NOT NULL,
        "aliases"        TEXT,
        "description"    TEXT,
        "serving_desc"   VARCHAR(100),
        "created_at"     TIMESTAMP    NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMP    NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_food_translations_food_locale" UNIQUE ("food_id", "locale")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_translations_food_id" ON food_translations ("food_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_translations_locale" ON food_translations ("locale")`,
    );

    // ══════════════════════════════════════════════════════════════
    // 8. 创建 food_sources 表
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_sources" (
        "id"            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "food_id"       UUID         NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        "source_type"   VARCHAR(50)  NOT NULL,
        "source_id"     VARCHAR(200),
        "source_url"    VARCHAR(500),
        "raw_data"      JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "mapped_data"   JSONB,
        "confidence"    DECIMAL(3,2) NOT NULL DEFAULT 0.80,
        "is_primary"    BOOLEAN      NOT NULL DEFAULT FALSE,
        "priority"      INT          NOT NULL DEFAULT 50,
        "fetched_at"    TIMESTAMP    NOT NULL DEFAULT NOW(),
        "created_at"    TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_sources_food_id" ON food_sources ("food_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_sources_type" ON food_sources ("source_type")`,
    );

    // ══════════════════════════════════════════════════════════════
    // 9. 创建 food_change_logs 表
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_change_logs" (
        "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "food_id"     UUID         NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        "version"     INT          NOT NULL,
        "action"      VARCHAR(20)  NOT NULL,
        "changes"     JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "reason"      TEXT,
        "operator"    VARCHAR(100),
        "created_at"  TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_change_logs_food_version" ON food_change_logs ("food_id", "version")`,
    );

    // ══════════════════════════════════════════════════════════════
    // 10. 创建 food_conflicts 表
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_conflicts" (
        "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "food_id"        UUID         NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        "field"          VARCHAR(50)  NOT NULL,
        "sources"        JSONB        NOT NULL DEFAULT '[]'::jsonb,
        "resolution"     VARCHAR(20),
        "resolved_value" TEXT,
        "resolved_by"    VARCHAR(100),
        "resolved_at"    TIMESTAMP,
        "created_at"     TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_conflicts_food_id" ON food_conflicts ("food_id")`,
    );

    // ══════════════════════════════════════════════════════════════
    // 11. 创建 food_regional_info 表
    // ══════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "food_regional_info" (
        "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "food_id"          UUID         NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        "region"           VARCHAR(10)  NOT NULL,
        "local_popularity" INT          NOT NULL DEFAULT 0,
        "local_price_range" VARCHAR(20),
        "availability"     VARCHAR(20),
        "regulatory_info"  JSONB,
        "created_at"       TIMESTAMP    NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_food_regional_info_food_region" UNIQUE ("food_id", "region")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_regional_info_food_id" ON food_regional_info ("food_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_food_regional_info_region" ON food_regional_info ("region")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除关联表
    await queryRunner.query(`DROP TABLE IF EXISTS food_regional_info`);
    await queryRunner.query(`DROP TABLE IF EXISTS food_conflicts`);
    await queryRunner.query(`DROP TABLE IF EXISTS food_change_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS food_sources`);
    await queryRunner.query(`DROP TABLE IF EXISTS food_translations`);

    // 删除索引
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_foods_tags_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_foods_meal_types_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_foods_allergens_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_foods_code_unique"`);

    // 回滚中文分类 (best effort)
    await queryRunner.query(`
      UPDATE foods SET category = CASE category
        WHEN 'grain' THEN '主食'
        WHEN 'protein' THEN '肉类'
        WHEN 'veggie' THEN '蔬菜'
        WHEN 'fruit' THEN '水果'
        WHEN 'composite' THEN '快餐'
        WHEN 'beverage' THEN '饮品'
        WHEN 'snack' THEN '零食'
        WHEN 'condiment' THEN '调味料'
        ELSE category
      END
    `);

    // 删除新增列
    await queryRunner.query(`
      ALTER TABLE foods
        DROP COLUMN IF EXISTS "popularity",
        DROP COLUMN IF EXISTS "verified_at",
        DROP COLUMN IF EXISTS "verified_by",
        DROP COLUMN IF EXISTS "data_version",
        DROP COLUMN IF EXISTS "primary_source_id",
        DROP COLUMN IF EXISTS "thumbnail_url",
        DROP COLUMN IF EXISTS "image_url",
        DROP COLUMN IF EXISTS "common_portions",
        DROP COLUMN IF EXISTS "compatibility",
        DROP COLUMN IF EXISTS "nutrient_density",
        DROP COLUMN IF EXISTS "allergens",
        DROP COLUMN IF EXISTS "processing_level",
        DROP COLUMN IF EXISTS "glycemic_load",
        DROP COLUMN IF EXISTS "magnesium",
        DROP COLUMN IF EXISTS "zinc",
        DROP COLUMN IF EXISTS "folate",
        DROP COLUMN IF EXISTS "vitamin_b12",
        DROP COLUMN IF EXISTS "vitamin_e",
        DROP COLUMN IF EXISTS "vitamin_d",
        DROP COLUMN IF EXISTS "vitamin_c",
        DROP COLUMN IF EXISTS "vitamin_a",
        DROP COLUMN IF EXISTS "iron",
        DROP COLUMN IF EXISTS "calcium",
        DROP COLUMN IF EXISTS "potassium",
        DROP COLUMN IF EXISTS "cholesterol",
        DROP COLUMN IF EXISTS "trans_fat",
        DROP COLUMN IF EXISTS "saturated_fat",
        DROP COLUMN IF EXISTS "food_group",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "barcode",
        DROP COLUMN IF EXISTS "code"
    `);

    // 回滚列名
    await queryRunner
      .query(
        `ALTER TABLE foods RENAME COLUMN "calories" TO "calories_per_100g"`,
      )
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "protein" TO "protein_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "fat" TO "fat_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "carbs" TO "carbs_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "fiber" TO "fiber_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "sugar" TO "sugar_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "sodium" TO "sodium_per_100g"`)
      .catch(() => {});
    await queryRunner
      .query(`ALTER TABLE foods RENAME COLUMN "primary_source" TO "source"`)
      .catch(() => {});

    // 回滚列类型
    await queryRunner
      .query(
        `
      ALTER TABLE foods
        ALTER COLUMN "calories_per_100g" TYPE INT USING "calories_per_100g"::INT,
        ALTER COLUMN "quality_score" TYPE INT USING "quality_score"::INT,
        ALTER COLUMN "satiety_score" TYPE INT USING "satiety_score"::INT
    `,
      )
      .catch(() => {});
  }
}
