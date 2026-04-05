import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迁移：将 app_versions.platform 列改为可空（nullable）
 *
 * 背景：
 * - 原始表由 TypeORM synchronize 创建，platform 为 NOT NULL
 * - 此迁移将其改为 nullable，表示"全平台通用"版本
 */
export class MakeAppVersionPlatformNullable1740200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先确保 enum 类型存在（以防表是通过迁移而非 synchronize 创建的）
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "app_versions_platform_enum" AS ENUM ('android', 'ios');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 将 platform 列改为 nullable
    const col = await queryRunner.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'app_versions' AND column_name = 'platform'
    `);

    if (col.length > 0 && col[0].is_nullable === 'NO') {
      await queryRunner.query(`
        ALTER TABLE "app_versions" ALTER COLUMN "platform" DROP NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 将现有 NULL 值设为默认值后恢复 NOT NULL
    await queryRunner.query(`
      UPDATE "app_versions" SET "platform" = 'android' WHERE "platform" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "app_versions" ALTER COLUMN "platform" SET NOT NULL
    `);
  }
}
