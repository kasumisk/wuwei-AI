import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迁移：为 app_version_packages 表添加 platform 列（必填），
 * 并将唯一索引从 (versionId, channel) 改为 (versionId, channel, platform)
 */
export class AddPlatformToPackages1740300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先检查 platform 列是否已存在
    const col = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'app_version_packages' AND column_name = 'platform'
    `);
    if (col.length === 0) {
      // 创建 enum 类型（如果不存在）
      await queryRunner.query(`
        DO $$ BEGIN
          CREATE TYPE "app_version_packages_platform_enum" AS ENUM ('android', 'ios');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      // 添加 platform 列，先设为 nullable 以便给现有数据填默认值
      await queryRunner.query(`
        ALTER TABLE "app_version_packages"
          ADD COLUMN "platform" "app_version_packages_platform_enum"
      `);

      // 给现有数据设置默认值（根据渠道推断平台）
      await queryRunner.query(`
        UPDATE "app_version_packages"
        SET "platform" = CASE
          WHEN "channel" = 'app_store' THEN 'ios'::"app_version_packages_platform_enum"
          ELSE 'android'::"app_version_packages_platform_enum"
        END
        WHERE "platform" IS NULL
      `);

      // 设为 NOT NULL
      await queryRunner.query(`
        ALTER TABLE "app_version_packages"
          ALTER COLUMN "platform" SET NOT NULL
      `);
    }

    // 先删除约束（主键约束，而非独立索引），再删除残余索引
    await queryRunner.query(`
      ALTER TABLE "app_version_packages"
        DROP CONSTRAINT IF EXISTS "UQ_app_version_packages_version_channel"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_app_version_packages_version_channel"
    `);

    // 创建新的唯一索引
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_version_packages_version_channel_platform"
        ON "app_version_packages" ("versionId", "channel", "platform")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除新索引
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_app_version_packages_version_channel_platform"
    `);

    // 恢复旧唯一约束
    await queryRunner.query(`
      ALTER TABLE "app_version_packages"
        ADD CONSTRAINT "UQ_app_version_packages_version_channel"
        UNIQUE ("versionId", "channel")
    `);

    // 删除 platform 列
    await queryRunner.query(`
      ALTER TABLE "app_version_packages"
        DROP COLUMN IF EXISTS "platform"
    `);

    // 删除 enum 类型
    await queryRunner.query(`
      DROP TYPE IF EXISTS "app_version_packages_platform_enum"
    `);
  }
}
