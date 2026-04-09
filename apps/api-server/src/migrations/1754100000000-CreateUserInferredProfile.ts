import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserInferredProfile1754100000000 implements MigrationInterface {
  name = 'CreateUserInferredProfile1754100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_inferred_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid UNIQUE NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        estimated_bmr int,
        estimated_tdee int,
        recommended_calories int,
        macro_targets jsonb DEFAULT '{}',
        user_segment varchar(30),
        churn_risk decimal(3,2) DEFAULT 0,
        optimal_meal_count int,
        taste_pref_vector jsonb DEFAULT '[]',
        nutrition_gaps jsonb DEFAULT '[]',
        goal_progress jsonb DEFAULT '{}',
        confidence_scores jsonb DEFAULT '{}',
        last_computed_at timestamp,
        updated_at timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inferred_user ON user_inferred_profiles(user_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_inferred_profiles`);
  }
}
