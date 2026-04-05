import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowedProvidersAndModelsToPermission1730900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 添加 allowed_providers 字段（如果不存在）
    await queryRunner.query(`
      ALTER TABLE "client_capability_permissions"
      ADD COLUMN IF NOT EXISTS "allowed_providers" text
    `);

    // 添加 allowed_models 字段（如果不存在）
    await queryRunner.query(`
      ALTER TABLE "client_capability_permissions"
      ADD COLUMN IF NOT EXISTS "allowed_models" text
    `);

    // 迁移现有数据：将 config.allowedModels 移到顶层
    await queryRunner.query(`
      UPDATE "client_capability_permissions"
      SET "allowed_models" = (config->>'allowedModels')::text
      WHERE config IS NOT NULL 
        AND config->>'allowedModels' IS NOT NULL
        AND jsonb_typeof(config->'allowedModels') = 'array'
    `);

    // 注释：数据迁移完成后，需要手动清理 config 中的 allowedModels 字段
    console.log(
      '✅ Migration completed. Consider cleaning up config.allowedModels in a future migration.',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：将 allowed_models 的数据移回 config.allowedModels
    await queryRunner.query(`
      UPDATE "client_capability_permissions"
      SET config = jsonb_set(
        COALESCE(config, '{}'::jsonb),
        '{allowedModels}',
        to_jsonb(string_to_array("allowed_models", ','))
      )
      WHERE "allowed_models" IS NOT NULL
    `);

    // 删除新增的字段
    await queryRunner.query(`
      ALTER TABLE "client_capability_permissions"
      DROP COLUMN "allowed_models"
    `);

    await queryRunner.query(`
      ALTER TABLE "client_capability_permissions"
      DROP COLUMN "allowed_providers"
    `);
  }
}
