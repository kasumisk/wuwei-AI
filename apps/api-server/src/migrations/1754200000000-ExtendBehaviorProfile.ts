import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendBehaviorProfile1754200000000 implements MigrationInterface {
  name = 'ExtendBehaviorProfile1754200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_behavior_profiles
        ADD COLUMN IF NOT EXISTS meal_timing_patterns jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS portion_tendency varchar(10) DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS replacement_patterns jsonb DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_behavior_profiles
        DROP COLUMN IF EXISTS meal_timing_patterns,
        DROP COLUMN IF EXISTS portion_tendency,
        DROP COLUMN IF EXISTS replacement_patterns
    `);
  }
}
