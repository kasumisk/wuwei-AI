import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 2.12 — 创建订阅模块表
 *
 * - subscription_plan: 订阅计划定义（Free/Pro/Premium + 计费周期 + 权益 JSONB）
 * - subscription: 用户订阅记录（状态机 + 到期管理 + 宽限期）
 * - payment_record: 支付事务记录（多渠道 + 回调存储 + 退款追踪）
 * - usage_quota: 用量配额追踪（按功能 + 按周期 + 重置时间）
 */
export class CreateSubscriptionTables1762400000000 implements MigrationInterface {
  name = 'CreateSubscriptionTables1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── subscription_plan 表 ───
    await queryRunner.query(`
      CREATE TABLE "subscription_plan" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "description" text,
        "tier" varchar(32) NOT NULL,
        "billing_cycle" varchar(32) NOT NULL,
        "price_cents" int NOT NULL,
        "currency" varchar(8) NOT NULL DEFAULT 'CNY',
        "entitlements" jsonb NOT NULL DEFAULT '{}',
        "apple_product_id" varchar(256),
        "wechat_product_id" varchar(256),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_plan" PRIMARY KEY ("id")
      )
    `);

    // 按等级查找
    await queryRunner.query(`
      CREATE INDEX "idx_subscription_plan_tier"
      ON "subscription_plan" ("tier")
    `);

    // 按上架状态筛选
    await queryRunner.query(`
      CREATE INDEX "idx_subscription_plan_active"
      ON "subscription_plan" ("is_active")
    `);

    // ─── subscription 表 ───
    await queryRunner.query(`
      CREATE TABLE "subscription" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "payment_channel" varchar(32) NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "cancelled_at" timestamptz,
        "auto_renew" boolean NOT NULL DEFAULT true,
        "platform_subscription_id" varchar(512),
        "grace_period_ends_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_plan" FOREIGN KEY ("plan_id")
          REFERENCES "subscription_plan" ("id") ON DELETE RESTRICT
      )
    `);

    // 按用户查找
    await queryRunner.query(`
      CREATE INDEX "idx_subscription_user"
      ON "subscription" ("user_id")
    `);

    // 按用户 + 状态查找（获取活跃订阅）
    await queryRunner.query(`
      CREATE INDEX "idx_subscription_user_status"
      ON "subscription" ("user_id", "status")
    `);

    // 按到期时间查找（批量过期处理 Cron）
    await queryRunner.query(`
      CREATE INDEX "idx_subscription_expires"
      ON "subscription" ("expires_at")
    `);

    // ─── payment_record 表 ───
    await queryRunner.query(`
      CREATE TABLE "payment_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "subscription_id" uuid,
        "order_no" varchar(64) NOT NULL,
        "channel" varchar(32) NOT NULL,
        "amount_cents" int NOT NULL,
        "currency" varchar(8) NOT NULL DEFAULT 'CNY',
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "platform_transaction_id" varchar(512),
        "callback_payload" jsonb,
        "refund_amount_cents" int NOT NULL DEFAULT 0,
        "paid_at" timestamptz,
        "refunded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_record" PRIMARY KEY ("id")
      )
    `);

    // 按用户查找
    await queryRunner.query(`
      CREATE INDEX "idx_payment_user"
      ON "payment_record" ("user_id")
    `);

    // 订单号唯一索引（防重放）
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_payment_order"
      ON "payment_record" ("order_no")
    `);

    // 按状态筛选
    await queryRunner.query(`
      CREATE INDEX "idx_payment_status"
      ON "payment_record" ("status")
    `);

    // 按渠道 + 状态筛选（对账用）
    await queryRunner.query(`
      CREATE INDEX "idx_payment_channel_status"
      ON "payment_record" ("channel", "status")
    `);

    // ─── usage_quota 表 ───
    await queryRunner.query(`
      CREATE TABLE "usage_quota" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "feature" varchar(64) NOT NULL,
        "used" int NOT NULL DEFAULT 0,
        "quota_limit" int NOT NULL DEFAULT 0,
        "cycle" varchar(16) NOT NULL DEFAULT 'daily',
        "reset_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_quota" PRIMARY KEY ("id")
      )
    `);

    // 用户 + 功能唯一索引（每个用户每个功能只有一条记录）
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_usage_quota_user_feature"
      ON "usage_quota" ("user_id", "feature")
    `);

    // 按重置时间查找（批量重置 Cron）
    await queryRunner.query(`
      CREATE INDEX "idx_usage_quota_reset"
      ON "usage_quota" ("reset_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "usage_quota"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plan"`);
  }
}
