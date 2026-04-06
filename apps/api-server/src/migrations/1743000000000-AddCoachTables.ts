import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoachTables1743000000000 implements MigrationInterface {
  name = 'AddCoachTables1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 创建 coach_conversations 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coach_conversations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
        "title" VARCHAR(200),
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_coach_conversations_user"
        ON "coach_conversations"("user_id", "updated_at" DESC);
    `);

    // 2. 创建 coach_messages 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coach_messages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL REFERENCES "coach_conversations"("id") ON DELETE CASCADE,
        "role" VARCHAR(20) NOT NULL,
        "content" TEXT NOT NULL,
        "tokens_used" INT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_coach_messages_conv"
        ON "coach_messages"("conversation_id", "created_at" ASC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coach_messages";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coach_conversations";`);
  }
}
