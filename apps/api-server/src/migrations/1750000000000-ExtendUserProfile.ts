import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 扩展 user_profiles 表
 * 根据 PRODUCTION2.md 的用户档案体系，增加目标/饮食习惯/行为习惯字段
 */
export class ExtendUserProfile1750000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
        ADD COLUMN IF NOT EXISTS goal VARCHAR(30) DEFAULT 'health',
        ADD COLUMN IF NOT EXISTS goal_speed VARCHAR(20) DEFAULT 'steady',
        ADD COLUMN IF NOT EXISTS body_fat_percent DECIMAL(4,1),
        ADD COLUMN IF NOT EXISTS meals_per_day INT DEFAULT 3,
        ADD COLUMN IF NOT EXISTS takeout_frequency VARCHAR(20) DEFAULT 'sometimes',
        ADD COLUMN IF NOT EXISTS can_cook BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS food_preferences JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS dietary_restrictions JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS weak_time_slots JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS binge_triggers JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS discipline VARCHAR(20) DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
        DROP COLUMN IF EXISTS goal,
        DROP COLUMN IF EXISTS goal_speed,
        DROP COLUMN IF EXISTS body_fat_percent,
        DROP COLUMN IF EXISTS meals_per_day,
        DROP COLUMN IF EXISTS takeout_frequency,
        DROP COLUMN IF EXISTS can_cook,
        DROP COLUMN IF EXISTS food_preferences,
        DROP COLUMN IF EXISTS dietary_restrictions,
        DROP COLUMN IF EXISTS weak_time_slots,
        DROP COLUMN IF EXISTS binge_triggers,
        DROP COLUMN IF EXISTS discipline,
        DROP COLUMN IF EXISTS onboarding_completed;
    `);
  }
}
