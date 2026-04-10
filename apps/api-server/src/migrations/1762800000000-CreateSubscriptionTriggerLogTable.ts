import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * V6.1 Phase 1.7 — 创建 subscription_trigger_log 表
 *
 * 记录付费墙触发事件，支撑转化漏斗分析
 */
export class CreateSubscriptionTriggerLogTable1762800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'subscription_trigger_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'trigger_scene',
            type: 'varchar',
            length: '30',
            isNullable: false,
          },
          {
            name: 'feature',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'current_tier',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'recommended_plan',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'ab_bucket',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'converted',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    // 索引
    await queryRunner.createIndex(
      'subscription_trigger_log',
      new TableIndex({
        name: 'idx_trigger_log_user_id',
        columnNames: ['user_id'],
      }),
    );
    await queryRunner.createIndex(
      'subscription_trigger_log',
      new TableIndex({
        name: 'idx_trigger_log_user_created',
        columnNames: ['user_id', 'created_at'],
      }),
    );
    await queryRunner.createIndex(
      'subscription_trigger_log',
      new TableIndex({
        name: 'idx_trigger_log_scene',
        columnNames: ['trigger_scene'],
      }),
    );
    await queryRunner.createIndex(
      'subscription_trigger_log',
      new TableIndex({
        name: 'idx_trigger_log_converted',
        columnNames: ['converted'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('subscription_trigger_log', true);
  }
}
