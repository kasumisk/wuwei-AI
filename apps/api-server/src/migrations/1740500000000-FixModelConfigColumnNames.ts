import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迁移：修正 model_configs 扩展列名
 * 将 MergeCapabilityIntoModel 迁移创建的 snake_case 列名
 * 统一改为和实体属性名一致的 camelCase
 */
export class FixModelConfigColumnNames1740500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // custom_api_key → customApiKey
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'custom_api_key'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'customApiKey'
        ) THEN
          ALTER TABLE model_configs
            RENAME COLUMN custom_api_key TO "customApiKey";
        END IF;
      END $$;
    `);

    // custom_timeout → customTimeout
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'custom_timeout'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'customTimeout'
        ) THEN
          ALTER TABLE model_configs
            RENAME COLUMN custom_timeout TO "customTimeout";
        END IF;
      END $$;
    `);

    // custom_retries → customRetries
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'custom_retries'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'customRetries'
        ) THEN
          ALTER TABLE model_configs
            RENAME COLUMN custom_retries TO "customRetries";
        END IF;
      END $$;
    `);

    // config_metadata → configMetadata
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'config_metadata'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'model_configs' AND column_name = 'configMetadata'
        ) THEN
          ALTER TABLE model_configs
            RENAME COLUMN config_metadata TO "configMetadata";
        END IF;
      END $$;
    `);

    // 同时确保 metadata 列存在（entity 中有，但迁移中可能没创建）
    await queryRunner.query(`
      ALTER TABLE model_configs
        ADD COLUMN IF NOT EXISTS metadata JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE model_configs RENAME COLUMN "customApiKey"    TO custom_api_key`,
    );
    await queryRunner.query(
      `ALTER TABLE model_configs RENAME COLUMN "customTimeout"   TO custom_timeout`,
    );
    await queryRunner.query(
      `ALTER TABLE model_configs RENAME COLUMN "customRetries"   TO custom_retries`,
    );
    await queryRunner.query(
      `ALTER TABLE model_configs RENAME COLUMN "configMetadata"  TO config_metadata`,
    );
  }
}
