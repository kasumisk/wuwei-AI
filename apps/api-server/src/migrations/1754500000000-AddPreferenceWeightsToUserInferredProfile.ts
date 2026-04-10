import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferenceWeightsToUserInferredProfile1754500000000
  implements MigrationInterface
{
  name = 'AddPreferenceWeightsToUserInferredProfile1754500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_inferred_profiles"
      ADD COLUMN IF NOT EXISTS "preference_weights" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_inferred_profiles"
      DROP COLUMN IF EXISTS "preference_weights"
    `);
  }
}