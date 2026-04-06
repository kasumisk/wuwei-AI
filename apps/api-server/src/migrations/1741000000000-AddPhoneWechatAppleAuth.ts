import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhoneWechatAppleAuth1741000000000
  implements MigrationInterface
{
  name = 'AddPhoneWechatAppleAuth1741000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 扩展 auth_type 枚举，新增 phone / wechat / wechat_mini / apple
    await queryRunner.query(`
      ALTER TYPE "app_user_auth_type_enum"
        ADD VALUE IF NOT EXISTS 'phone';
    `);
    await queryRunner.query(`
      ALTER TYPE "app_user_auth_type_enum"
        ADD VALUE IF NOT EXISTS 'wechat';
    `);
    await queryRunner.query(`
      ALTER TYPE "app_user_auth_type_enum"
        ADD VALUE IF NOT EXISTS 'wechat_mini';
    `);
    await queryRunner.query(`
      ALTER TYPE "app_user_auth_type_enum"
        ADD VALUE IF NOT EXISTS 'apple';
    `);

    // 2. 新增字段
    await queryRunner.query(`
      ALTER TABLE "app_users"
        ADD COLUMN IF NOT EXISTS "phone" VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "phone_verified" BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "wechat_open_id" VARCHAR(128),
        ADD COLUMN IF NOT EXISTS "wechat_union_id" VARCHAR(128),
        ADD COLUMN IF NOT EXISTS "apple_id" VARCHAR(255);
    `);

    // 3. 唯一索引（部分索引，只对非 NULL 值生效）
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_phone"
        ON "app_users"("phone") WHERE "phone" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_wechat_open_id"
        ON "app_users"("wechat_open_id") WHERE "wechat_open_id" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_users_apple_id"
        ON "app_users"("apple_id") WHERE "apple_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_apple_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_wechat_open_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_app_users_phone"`,
    );

    await queryRunner.query(`
      ALTER TABLE "app_users"
        DROP COLUMN IF EXISTS "apple_id",
        DROP COLUMN IF EXISTS "wechat_union_id",
        DROP COLUMN IF EXISTS "wechat_open_id",
        DROP COLUMN IF EXISTS "phone_verified",
        DROP COLUMN IF EXISTS "phone";
    `);

    // 注意：PostgreSQL 的 ENUM 值无法轻松删除，down 里只删字段
  }
}
