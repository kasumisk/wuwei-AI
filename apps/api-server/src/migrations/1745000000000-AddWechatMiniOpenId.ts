import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWechatMiniOpenId1745000000000 implements MigrationInterface {
  name = 'AddWechatMiniOpenId1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "app_users"
        ADD COLUMN IF NOT EXISTS "wechat_mini_open_id" VARCHAR(128);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_wechat_mini_open_id"
        ON "app_users"("wechat_mini_open_id") WHERE "wechat_mini_open_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_wechat_mini_open_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "wechat_mini_open_id"`,
    );
  }
}
