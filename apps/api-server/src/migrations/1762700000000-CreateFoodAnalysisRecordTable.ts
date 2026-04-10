import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6.1 Phase 1.5: 创建食物分析记录表 food_analysis_record
 *
 * 用于保存文本/图片分析过程记录，每次分析请求生成一条记录，
 * 记录输入快照、识别结果、标准化结果、营养估算、决策建议和入库状态。
 *
 * 不与现有 food_records（饮食记录）混淆，food_analysis_record 是分析过程的全量归档，
 * food_records 是用户确认保存的饮食日志。
 */
export class CreateFoodAnalysisRecordTable1762700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "food_analysis_record" (
        "id"                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"              UUID NOT NULL,
        "input_type"           VARCHAR(10) NOT NULL,
        "raw_text"             TEXT,
        "image_url"            VARCHAR(500),
        "meal_type"            VARCHAR(20),
        "status"               VARCHAR(20) NOT NULL DEFAULT 'completed',
        "recognized_payload"   JSONB,
        "normalized_payload"   JSONB,
        "nutrition_payload"    JSONB,
        "decision_payload"     JSONB,
        "confidence_score"     DECIMAL(5, 2),
        "quality_score"        DECIMAL(5, 2),
        "matched_food_count"   INTEGER NOT NULL DEFAULT 0,
        "candidate_food_count" INTEGER NOT NULL DEFAULT 0,
        "persist_status"       VARCHAR(20) NOT NULL DEFAULT 'pending',
        "source_request_id"    VARCHAR(64),
        "created_at"           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 索引: 按用户 ID 查询
    await queryRunner.query(`
      CREATE INDEX "idx_food_analysis_record_user_id"
        ON "food_analysis_record" ("user_id");
    `);

    // 索引: 按用户 + 时间查询（历史分析记录列表、最近 N 条）
    await queryRunner.query(`
      CREATE INDEX "idx_food_analysis_record_user_created"
        ON "food_analysis_record" ("user_id", "created_at" DESC);
    `);

    // 索引: 按输入类型查询（统计文本/图片分析占比）
    await queryRunner.query(`
      CREATE INDEX "idx_food_analysis_record_input_type"
        ON "food_analysis_record" ("input_type");
    `);

    // 索引: 按状态查询（筛选失败记录重试等）
    await queryRunner.query(`
      CREATE INDEX "idx_food_analysis_record_status"
        ON "food_analysis_record" ("status");
    `);

    // 索引: 按异步请求 ID 查询（图片分析关联）
    await queryRunner.query(`
      CREATE INDEX "idx_food_analysis_record_source_request"
        ON "food_analysis_record" ("source_request_id")
        WHERE "source_request_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_food_analysis_record_source_request";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_food_analysis_record_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_food_analysis_record_input_type";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_food_analysis_record_user_created";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_food_analysis_record_user_id";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "food_analysis_record";`);
  }
}
