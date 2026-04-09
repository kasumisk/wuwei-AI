import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAppVersionUniqueConstraint1740600000000 implements MigrationInterface {
  name = 'FixAppVersionUniqueConstraint1740600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop old unique constraint on version alone
    await queryRunner.query(
      `ALTER TABLE "app_versions" DROP CONSTRAINT IF EXISTS "UQ_app_versions_version"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_app_versions_version"`);
    // Create new unique index on (platform, version) combo
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_app_versions_platform_version" ON "app_versions" ("platform", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_app_versions_platform_version"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_app_versions_version" ON "app_versions" ("version")`,
    );
  }
}
