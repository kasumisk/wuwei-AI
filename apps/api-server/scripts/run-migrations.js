/**
 * 数据库迁移修复 & 执行脚本
 * 用于本地和 Railway 部署
 *
 * 用法:
 *   本地: node ./scripts/run-migrations.js
 *   Railway: DB_HOST=metro.proxy.rlwy.net DB_PORT=33335 DB_USERNAME=postgres DB_PASSWORD=xxx DB_DATABASE=railway node ./scripts/run-migrations.js
 */
const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'ai_platform',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

/** 记录一个已执行的迁移（幂等） */
async function markMigration(name, timestamp) {
  const exists = await ds.query(
    'SELECT 1 FROM migrations WHERE name = $1', [name]
  );
  if (exists.length > 0) {
    console.log(`⏭️  ${name} 已记录`);
    return false;
  }
  await ds.query(
    'INSERT INTO migrations (timestamp, name) VALUES ($1, $2)',
    [timestamp, name]
  );
  console.log(`✅ 标记 ${name} 已执行`);
  return true;
}

/** 检查表是否存在 */
async function tableExists(tableName) {
  const r = await ds.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
    [tableName]
  );
  return r[0].exists;
}

/** 检查列是否存在 */
async function columnExists(tableName, columnName) {
  const r = await ds.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)",
    [tableName, columnName]
  );
  return r[0].exists;
}

/** 检查列是否 nullable */
async function isColumnNullable(tableName, columnName) {
  const r = await ds.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [tableName, columnName]
  );
  return r.length > 0 && r[0].is_nullable === 'YES';
}

async function main() {
  await ds.initialize();
  console.log(`📦 已连接 ${ds.options.host}:${ds.options.port}/${ds.options.database}\n`);

  // 确保 migrations 表存在
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id" SERIAL PRIMARY KEY,
      "timestamp" BIGINT NOT NULL,
      "name" VARCHAR(255) NOT NULL
    )
  `);

  // ========== 1. SplitUsersTable ==========
  if (await tableExists('admin_users')) {
    await markMigration('SplitUsersTable1740000000000', 1740000000000);
  }

  // ========== 2. AddAppVersionPackages ==========
  if (await tableExists('app_version_packages')) {
    await markMigration('AddAppVersionPackages1740100000000', 1740100000000);
  }

  // ========== 3. MakeAppVersionPlatformNullable ==========
  const m3Name = 'MakeAppVersionPlatformNullable1740200000000';
  const m3Exists = (await ds.query('SELECT 1 FROM migrations WHERE name = $1', [m3Name])).length > 0;
  if (!m3Exists && await tableExists('app_versions')) {
    console.log(`🔄 执行 ${m3Name}...`);
    await ds.query('BEGIN');
    try {
      if (!(await isColumnNullable('app_versions', 'platform'))) {
        await ds.query('ALTER TABLE "app_versions" ALTER COLUMN "platform" DROP NOT NULL');
        console.log('   ✅ platform 列改为 nullable');
      } else {
        console.log('   ⏭️  platform 列已是 nullable');
      }
      await ds.query('INSERT INTO migrations (timestamp, name) VALUES ($1, $2)', [1740200000000, m3Name]);
      await ds.query('COMMIT');
      console.log(`✅ ${m3Name} 执行成功`);
    } catch (err) {
      await ds.query('ROLLBACK');
      console.error(`❌ ${m3Name} 失败:`, err.message);
      throw err;
    }
  } else if (m3Exists) {
    console.log(`⏭️  ${m3Name} 已记录`);
  }

  // ========== 4. AddPlatformToPackages ==========
  const m4Name = 'AddPlatformToPackages1740300000000';
  const m4Exists = (await ds.query('SELECT 1 FROM migrations WHERE name = $1', [m4Name])).length > 0;
  if (!m4Exists && await tableExists('app_version_packages')) {
    console.log(`🔄 执行 ${m4Name}...`);
    await ds.query('BEGIN');
    try {
      if (!(await columnExists('app_version_packages', 'platform'))) {
        // 创建 enum
        await ds.query(`
          DO $$ BEGIN
            CREATE TYPE "app_version_packages_platform_enum" AS ENUM ('android', 'ios');
          EXCEPTION
            WHEN duplicate_object THEN null;
          END $$;
        `);
        // 添加 nullable 列
        await ds.query(`
          ALTER TABLE "app_version_packages"
            ADD COLUMN "platform" "app_version_packages_platform_enum"
        `);
        // 填充现有数据
        await ds.query(`
          UPDATE "app_version_packages"
          SET "platform" = CASE
            WHEN "channel" = 'app_store' THEN 'ios'::"app_version_packages_platform_enum"
            ELSE 'android'::"app_version_packages_platform_enum"
          END
          WHERE "platform" IS NULL
        `);
        // 设为 NOT NULL
        await ds.query(`
          ALTER TABLE "app_version_packages"
            ALTER COLUMN "platform" SET NOT NULL
        `);
        console.log('   ✅ platform 列已添加');
      } else {
        console.log('   ⏭️  platform 列已存在');
      }

      // 更新唯一索引
      await ds.query('DROP INDEX IF EXISTS "UQ_app_version_packages_version_channel"');
      await ds.query('ALTER TABLE "app_version_packages" DROP CONSTRAINT IF EXISTS "UQ_app_version_packages_version_channel"');
      await ds.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_app_version_packages_version_channel_platform"
          ON "app_version_packages" ("versionId", "channel", "platform")
      `);
      console.log('   ✅ 唯一索引已更新为 (versionId, channel, platform)');

      await ds.query('INSERT INTO migrations (timestamp, name) VALUES ($1, $2)', [1740300000000, m4Name]);
      await ds.query('COMMIT');
      console.log(`✅ ${m4Name} 执行成功`);
    } catch (err) {
      await ds.query('ROLLBACK');
      console.error(`❌ ${m4Name} 失败:`, err.message);
      throw err;
    }
  } else if (m4Exists) {
    console.log(`⏭️  ${m4Name} 已记录`);
  }

  // 显示最终结果
  const rows = await ds.query('SELECT * FROM migrations ORDER BY id');
  console.log('\n📋 所有迁移记录:', rows.map(r => r.name));

  await ds.destroy();
  console.log('\n✅ 完成');
}

main().catch(e => { console.error(e); process.exit(1); });
