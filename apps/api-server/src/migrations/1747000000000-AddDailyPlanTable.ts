import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyPlanTable1747000000000 implements MigrationInterface {
  name = 'AddDailyPlanTable1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS daily_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        morning_plan JSONB,
        lunch_plan JSONB,
        dinner_plan JSONB,
        snack_plan JSONB,
        adjustments JSONB DEFAULT '[]',
        strategy TEXT,
        total_budget INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date ON daily_plans(user_id, date DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_daily_plans_user_date;
      DROP TABLE IF EXISTS daily_plans;
    `);
  }
}
