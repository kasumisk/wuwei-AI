import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迁移：将 app_versions 表中的渠道包字段拆分到独立的 app_version_packages 表
 *
 * 变更：
 * 1. 创建 app_version_packages 表（渠道包，每个版本可有多个渠道）
 * 2. 将 app_versions 中现有的 downloadUrl/fileSize/checksum/channel 数据迁移到新表
 * 3. 删除 app_versions 中的 downloadUrl、fileSize、checksum、channel 列
 */
export class AddAppVersionPackages1740100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 前置：确保 app_versions 表存在（全新数据库适配）
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "app_versions_platform_enum" AS ENUM ('android', 'ios');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE "app_versions_updateType_enum" AS ENUM ('optional', 'force');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE "app_versions_status_enum" AS ENUM ('draft', 'published', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS "app_versions" (
        "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
        "platform"             "app_versions_platform_enum",
        "version"              VARCHAR(50) NOT NULL,
        "versionCode"          INTEGER     NOT NULL,
        "updateType"           "app_versions_updateType_enum" NOT NULL DEFAULT 'optional',
        "title"                VARCHAR(255) NOT NULL DEFAULT '',
        "description"          TEXT        NOT NULL DEFAULT '',
        "minSupportVersion"    VARCHAR(50),
        "minSupportVersionCode" INTEGER,
        "status"               "app_versions_status_enum" NOT NULL DEFAULT 'draft',
        "grayRelease"          BOOLEAN     NOT NULL DEFAULT false,
        "grayPercent"          INTEGER     NOT NULL DEFAULT 0,
        "releaseDate"          TIMESTAMP,
        "i18nDescription"      JSONB,
        "metadata"             JSONB,
        "createdAt"            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_app_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_app_versions_version" UNIQUE ("version")
      );
    `);

    // 1. 创建渠道包表
    await queryRunner.query(`
      CREATE TABLE "app_version_packages" (
        "id"          UUID        NOT NULL DEFAULT uuid_generate_v4(),
        "versionId"   UUID        NOT NULL,
        "channel"     VARCHAR(50) NOT NULL,
        "downloadUrl" VARCHAR(1000) NOT NULL,
        "fileSize"    BIGINT      NOT NULL DEFAULT 0,
        "checksum"    VARCHAR(255),
        "enabled"     BOOLEAN     NOT NULL DEFAULT true,
        "createdAt"   TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_version_packages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_app_version_packages_version_channel"
          UNIQUE ("versionId", "channel"),
        CONSTRAINT "FK_app_version_packages_version"
          FOREIGN KEY ("versionId") REFERENCES "app_versions" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_app_version_packages_versionId"
        ON "app_version_packages" ("versionId")
    `);

    // 2. 将现有版本数据迁移到渠道包表（仅当旧字段存在时）
    const channelColExists = await queryRunner.query(`
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_name = 'app_versions' AND column_name = 'channel'
    `);
    if (parseInt(channelColExists[0].count, 10) > 0) {
      await queryRunner.query(`
        INSERT INTO "app_version_packages"
          ("versionId", "channel", "downloadUrl", "fileSize", "checksum", "enabled")
        SELECT
          "id",
          COALESCE("channel", 'official'),
          "downloadUrl",
          COALESCE("fileSize", 0),
          "checksum",
          true
        FROM "app_versions"
        WHERE "downloadUrl" IS NOT NULL AND "downloadUrl" != ''
      `);

      // 3. 删除 app_versions 中的渠道包相关列
      await queryRunner.query(`
        ALTER TABLE "app_versions"
          DROP COLUMN IF EXISTS "downloadUrl",
          DROP COLUMN IF EXISTS "fileSize",
          DROP COLUMN IF EXISTS "checksum",
          DROP COLUMN IF EXISTS "channel"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. 恢复 app_versions 中的列
    await queryRunner.query(`
      ALTER TABLE "app_versions"
        ADD COLUMN "downloadUrl" VARCHAR(1000) NOT NULL DEFAULT '',
        ADD COLUMN "fileSize"    BIGINT        NOT NULL DEFAULT 0,
        ADD COLUMN "checksum"    VARCHAR(255),
        ADD COLUMN "channel"     VARCHAR(50)   NOT NULL DEFAULT 'official'
    `);

    // 2. 将 official 渠道数据回填
    await queryRunner.query(`
      UPDATE "app_versions" v
      SET
        "downloadUrl" = p."downloadUrl",
        "fileSize"    = p."fileSize",
        "checksum"    = p."checksum",
        "channel"     = p."channel"
      FROM "app_version_packages" p
      WHERE p."versionId" = v."id"
        AND p."channel" = 'official'
    `);

    // 3. 删除渠道包表
    await queryRunner.query(`DROP TABLE IF EXISTS "app_version_packages"`);
  }
}
