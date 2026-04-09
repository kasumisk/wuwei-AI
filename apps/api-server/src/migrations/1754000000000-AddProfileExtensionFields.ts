import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileExtensionFields1754000000000 implements MigrationInterface {
  name = 'AddProfileExtensionFields1754000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
        ADD COLUMN IF NOT EXISTS allergens jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS health_conditions jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS exercise_profile jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS cooking_skill_level varchar(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS taste_intensity jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS cuisine_preferences jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS budget_level varchar(10) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS family_size int DEFAULT 1,
        ADD COLUMN IF NOT EXISTS meal_prep_willing boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS region_code varchar(5) DEFAULT 'CN',
        ADD COLUMN IF NOT EXISTS onboarding_step int DEFAULT 0,
        ADD COLUMN IF NOT EXISTS data_completeness decimal(3,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS profile_version int DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
        DROP COLUMN IF EXISTS allergens,
        DROP COLUMN IF EXISTS health_conditions,
        DROP COLUMN IF EXISTS exercise_profile,
        DROP COLUMN IF EXISTS cooking_skill_level,
        DROP COLUMN IF EXISTS taste_intensity,
        DROP COLUMN IF EXISTS cuisine_preferences,
        DROP COLUMN IF EXISTS budget_level,
        DROP COLUMN IF EXISTS family_size,
        DROP COLUMN IF EXISTS meal_prep_willing,
        DROP COLUMN IF EXISTS region_code,
        DROP COLUMN IF EXISTS onboarding_step,
        DROP COLUMN IF EXISTS data_completeness,
        DROP COLUMN IF EXISTS profile_version
    `);
  }
}
