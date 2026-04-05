import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateInitialTables1699012345000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 创建 capability_configs 表
    await queryRunner.createTable(
      new Table({
        name: 'capability_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'capability_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'provider',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'model',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: true,
          },
          {
            name: 'priority',
            type: 'integer',
            default: 0,
          },
          {
            name: 'config',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'limits',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'pricing',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'capability_configs',
      new TableIndex({
        name: 'IDX_capability_type_provider_model',
        columnNames: ['capability_type', 'provider', 'model'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'capability_configs',
      new TableIndex({
        name: 'IDX_capability_enabled',
        columnNames: ['capability_type', 'enabled', 'priority'],
      }),
    );

    // 创建 clients 表
    await queryRunner.createTable(
      new Table({
        name: 'clients',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'api_key',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'api_secret',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'active'",
          },
          {
            name: 'quota_config',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // 创建 client_capability_permissions 表
    await queryRunner.createTable(
      new Table({
        name: 'client_capability_permissions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'capability_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: true,
          },
          {
            name: 'rate_limit',
            type: 'integer',
            default: 60,
          },
          {
            name: 'quota_limit',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'preferred_provider',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'config',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['client_id'],
            referencedTableName: 'clients',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'client_capability_permissions',
      new TableIndex({
        name: 'IDX_client_capability',
        columnNames: ['client_id', 'capability_type'],
        isUnique: true,
      }),
    );

    // 创建 usage_records 表
    await queryRunner.createTable(
      new Table({
        name: 'usage_records',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'request_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'capability_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'provider',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'model',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'usage',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'cost',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: false,
          },
          {
            name: 'response_time',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'timestamp',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'usage_records',
      new TableIndex({
        name: 'IDX_usage_client_timestamp',
        columnNames: ['client_id', 'timestamp'],
      }),
    );

    await queryRunner.createIndex(
      'usage_records',
      new TableIndex({
        name: 'IDX_usage_capability_timestamp',
        columnNames: ['capability_type', 'timestamp'],
      }),
    );

    await queryRunner.createIndex(
      'usage_records',
      new TableIndex({
        name: 'IDX_usage_provider_timestamp',
        columnNames: ['provider', 'timestamp'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('usage_records');
    await queryRunner.dropTable('client_capability_permissions');
    await queryRunner.dropTable('clients');
    await queryRunner.dropTable('capability_configs');
  }
}
