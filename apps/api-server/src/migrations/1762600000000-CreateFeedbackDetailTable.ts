import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 2.19: 创建多维反馈详情表 feedback_details
 *
 * 在原有 recommendation_feedbacks 单维度(accepted/replaced/skipped)基础上，
 * 增加口味、份量、价格、时间适合度四个独立评分维度，
 * 以及隐式行为信号（停留时间、详情展开）。
 */
export class CreateFeedbackDetailTable1762600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "feedback_details" (
        "id"              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "feedback_id"     UUID NOT NULL,
        "user_id"         UUID NOT NULL,
        "food_name"       VARCHAR(100) NOT NULL,
        "meal_type"       VARCHAR(20) NOT NULL,
        "taste_rating"    SMALLINT,
        "portion_rating"  SMALLINT,
        "price_rating"    SMALLINT,
        "timing_rating"   SMALLINT,
        "comment"         TEXT,
        "dwell_time_ms"   INTEGER,
        "detail_expanded" BOOLEAN,
        "created_at"      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "fk_feedback_details_feedback"
          FOREIGN KEY ("feedback_id")
          REFERENCES "recommendation_feedbacks"("id")
          ON DELETE CASCADE,

        CONSTRAINT "chk_taste_rating"
          CHECK ("taste_rating" IS NULL OR ("taste_rating" >= 1 AND "taste_rating" <= 5)),
        CONSTRAINT "chk_portion_rating"
          CHECK ("portion_rating" IS NULL OR ("portion_rating" >= 1 AND "portion_rating" <= 5)),
        CONSTRAINT "chk_price_rating"
          CHECK ("price_rating" IS NULL OR ("price_rating" >= 1 AND "price_rating" <= 5)),
        CONSTRAINT "chk_timing_rating"
          CHECK ("timing_rating" IS NULL OR ("timing_rating" >= 1 AND "timing_rating" <= 5))
      );
    `);

    // 索引: 按反馈 ID 查询
    await queryRunner.query(`
      CREATE INDEX "IDX_feedback_details_feedback_id"
        ON "feedback_details" ("feedback_id");
    `);

    // 索引: 按用户 + 时间查询（聚合统计用）
    await queryRunner.query(`
      CREATE INDEX "IDX_feedback_details_user_created"
        ON "feedback_details" ("user_id", "created_at");
    `);

    // 索引: 按用户 ID 查询
    await queryRunner.query(`
      CREATE INDEX "IDX_feedback_details_user_id"
        ON "feedback_details" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feedback_details_user_id";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feedback_details_user_created";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feedback_details_feedback_id";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "feedback_details";`);
  }
}
