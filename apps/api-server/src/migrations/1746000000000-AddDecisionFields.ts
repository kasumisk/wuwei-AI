import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDecisionFields1746000000000 implements MigrationInterface {
  name = 'AddDecisionFields1746000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        ADD COLUMN IF NOT EXISTS decision VARCHAR(10) DEFAULT 'SAFE',
        ADD COLUMN IF NOT EXISTS risk_level VARCHAR(5),
        ADD COLUMN IF NOT EXISTS reason TEXT,
        ADD COLUMN IF NOT EXISTS suggestion TEXT,
        ADD COLUMN IF NOT EXISTS instead_options JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS compensation JSONB,
        ADD COLUMN IF NOT EXISTS context_comment TEXT,
        ADD COLUMN IF NOT EXISTS encouragement TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        DROP COLUMN IF EXISTS decision,
        DROP COLUMN IF EXISTS risk_level,
        DROP COLUMN IF EXISTS reason,
        DROP COLUMN IF EXISTS suggestion,
        DROP COLUMN IF EXISTS instead_options,
        DROP COLUMN IF EXISTS compensation,
        DROP COLUMN IF EXISTS context_comment,
        DROP COLUMN IF EXISTS encouragement;
    `);
  }
}
