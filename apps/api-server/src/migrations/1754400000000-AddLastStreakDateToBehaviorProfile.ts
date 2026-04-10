import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastStreakDateToBehaviorProfile1754400000000
  implements MigrationInterface
{
  name = 'AddLastStreakDateToBehaviorProfile1754400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_behavior_profiles"
      ADD COLUMN IF NOT EXISTS "last_streak_date" varchar(10)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_behavior_profiles"
      DROP COLUMN IF EXISTS "last_streak_date"
    `);
  }
}