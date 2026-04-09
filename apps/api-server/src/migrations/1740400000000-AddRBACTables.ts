import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迁移：补全 RBAC 相关表（permissions / role_permissions / permission_templates）
 * 这些表在首次建库时被遗漏，本迁移补充创建（全部使用 IF NOT EXISTS）
 */
export class AddRBACTables1740400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "permission_type_enum" AS ENUM ('menu', 'operation');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE "permission_status_enum" AS ENUM ('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE "http_method_enum" AS ENUM ('GET', 'POST', 'PUT', 'DELETE', 'PATCH');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS "permissions" (
        "id"          uuid         NOT NULL DEFAULT gen_random_uuid(),
        "code"        varchar(100) NOT NULL,
        "name"        varchar(100) NOT NULL,
        "type"        "permission_type_enum" NOT NULL,
        "action"      "http_method_enum",
        "resource"    varchar(200),
        "parent_id"   uuid,
        "icon"        varchar(50),
        "description" varchar(500),
        "status"      "permission_status_enum" NOT NULL DEFAULT 'active',
        "is_system"   boolean      NOT NULL DEFAULT false,
        "sort"        integer      NOT NULL DEFAULT 0,
        "created_at"  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at"  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_permissions"       PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permissions_code"  UNIQUE ("code"),
        CONSTRAINT "FK_permissions_parent" FOREIGN KEY ("parent_id")
          REFERENCES "permissions"("id") ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "id"            uuid      NOT NULL DEFAULT gen_random_uuid(),
        "role_id"       uuid      NOT NULL,
        "permission_id" uuid      NOT NULL,
        "created_at"    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_permissions_role"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission"
          FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS "permission_templates" (
        "id"                  uuid         NOT NULL DEFAULT gen_random_uuid(),
        "code"                varchar(50)  NOT NULL,
        "name"                varchar(100) NOT NULL,
        "description"         varchar(500),
        "permission_patterns" text         NOT NULL DEFAULT '',
        "is_system"           boolean      NOT NULL DEFAULT false,
        "created_at"          timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at"          timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_permission_templates"      PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permission_templates_code" UNIQUE ("code")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "permission_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "http_method_enum" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "permission_status_enum" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "permission_type_enum" CASCADE`,
    );
  }
}
