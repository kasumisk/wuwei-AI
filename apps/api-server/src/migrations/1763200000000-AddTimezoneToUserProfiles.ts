import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimezoneToUserProfiles1763200000000 implements MigrationInterface {
  name = 'AddTimezoneToUserProfiles1763200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS timezone varchar(50) NOT NULL DEFAULT 'Asia/Shanghai'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
      DROP COLUMN IF EXISTS timezone
    `);
  }
}
