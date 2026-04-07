import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBehaviorTables1748000000000 implements MigrationInterface {
  name = 'AddBehaviorTables1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_behavior_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
        food_preferences JSONB DEFAULT '{}',
        binge_risk_hours JSONB DEFAULT '[]',
        failure_triggers JSONB DEFAULT '[]',
        avg_compliance_rate DECIMAL(3,2) DEFAULT 0,
        coach_style VARCHAR(20) DEFAULT 'friendly',
        total_records INT DEFAULT 0,
        healthy_records INT DEFAULT 0,
        streak_days INT DEFAULT 0,
        longest_streak INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ai_decision_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        record_id UUID REFERENCES food_records(id) ON DELETE SET NULL,
        input_context JSONB,
        input_image_url TEXT,
        decision VARCHAR(10),
        risk_level VARCHAR(5),
        full_response JSONB,
        user_followed BOOLEAN,
        user_feedback VARCHAR(20),
        actual_outcome VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON ai_decision_logs(user_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_ai_logs_user;
      DROP TABLE IF EXISTS ai_decision_logs;
      DROP TABLE IF EXISTS user_behavior_profiles;
    `);
  }
}
