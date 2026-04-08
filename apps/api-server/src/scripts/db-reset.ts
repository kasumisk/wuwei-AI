/**
 * 数据库重置脚本 — 全量替换重构专用
 *
 * 功能：
 * 1. 删除所有旧表（含级联依赖）
 * 2. 删除所有旧 enum 类型
 * 3. 使用 TypeORM synchronize 创建新表结构
 * 4. （可选）插入默认管理员
 *
 * 用法：
 *   pnpm --filter api-server db:reset
 *
 * 警告：此脚本会 ** 删除所有数据 **，仅用于开发环境初始化！
 */
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

config();

async function confirm(message: string): Promise<boolean> {
  if (process.env.DB_RESET_CONFIRM === 'yes') return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n⚠️  ${message} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const dbName = process.env.DB_DATABASE || 'wuwei_ai';
  console.log(`\n🗄️  目标数据库: ${dbName}`);
  console.log(`   主机: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}`);

  const ok = await confirm(`即将删除数据库 "${dbName}" 中的所有表和数据，是否继续？`);
  if (!ok) {
    console.log('已取消。');
    process.exit(0);
  }

  // Step 1: 连接数据库并清除旧结构
  const cleanDs = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    synchronize: false,
    logging: false,
    ...(process.env.DB_SSL === 'true' && {
      ssl: { rejectUnauthorized: false },
    }),
  });

  await cleanDs.initialize();
  console.log('\n✅ 已连接数据库');

  // 删除所有表
  console.log('🧹 正在删除所有表...');
  const tables = await cleanDs.query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' AND tablename != 'spatial_ref_sys'
  `);

  if (tables.length > 0) {
    const tableNames = tables.map((t: any) => `"${t.tablename}"`).join(', ');
    await cleanDs.query(`DROP TABLE IF EXISTS ${tableNames} CASCADE`);
    console.log(`   已删除 ${tables.length} 个表`);
  } else {
    console.log('   没有需要删除的表');
  }

  // 删除所有自定义 enum 类型
  console.log('🧹 正在删除所有自定义枚举类型...');
  const enums = await cleanDs.query(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `);

  for (const e of enums) {
    await cleanDs.query(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
  }
  console.log(`   已删除 ${enums.length} 个枚举类型`);

  // 删除 migrations 记录表
  await cleanDs.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);

  await cleanDs.destroy();
  console.log('✅ 旧结构清除完毕\n');

  // Step 2: 使用新实体定义同步创建表
  console.log('🔄 正在根据新实体定义创建表结构...');

  // 使用 glob 路径加载实体（避免 node16 moduleResolution 限制）
  const path = await import('path');
  const entitiesPath = path.join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}');

  const syncDs = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    synchronize: true,
    logging: ['schema'],
    entities: [entitiesPath],
    ...(process.env.DB_SSL === 'true' && {
      ssl: { rejectUnauthorized: false },
    }),
  });

  await syncDs.initialize();
  console.log('✅ 新表结构创建完毕\n');

  // Step 3: 插入默认管理员
  console.log('👤 正在创建默认管理员...');
  const adminRepo = syncDs.getRepository('AdminUser');
  const existing = await adminRepo.findOne({ where: { username: 'admin' } });
  if (!existing) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123456', salt);
    const admin = adminRepo.create({
      username: 'admin',
      password: hashedPassword,
      email: 'admin@wuwei.ai',
      nickname: '超级管理员',
    });
    await adminRepo.save(admin);
    console.log('   ✅ 默认管理员已创建: admin / admin123456');
  } else {
    console.log('   ⏭️  管理员已存在，跳过');
  }

  // Step 4: 生成初始迁移基线
  console.log('\n📝 正在记录迁移基线...');
  await syncDs.query(`
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id" SERIAL PRIMARY KEY,
      "timestamp" BIGINT NOT NULL,
      "name" VARCHAR NOT NULL
    )
  `);
  const timestamp = Date.now();
  await syncDs.query(
    `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
    [timestamp, `InitSchema${timestamp}`],
  );
  console.log('   ✅ 迁移基线已记录');

  await syncDs.destroy();

  console.log('\n🎉 数据库初始化完成！');
  console.log('   后续使用 pnpm --filter api-server migration:generate -- <name> 生成增量迁移\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ 数据库初始化失败:', err);
  process.exit(1);
});
