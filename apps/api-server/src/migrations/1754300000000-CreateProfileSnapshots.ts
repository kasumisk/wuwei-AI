import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProfileSnapshots1754300000000 implements MigrationInterface {
  name = 'CreateProfileSnapshots1754300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS profile_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        snapshot jsonb NOT NULL,
        trigger_type varchar(30) NOT NULL,
        changed_fields jsonb NOT NULL,
        created_at timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshot_user_time
        ON profile_snapshots(user_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS profile_snapshots`);
  }
}
