/**
 * sync-usda-missing/sync.mjs
 *
 * 全量拉取 USDA Foundation + SR Legacy 食物数据，
 * 对比本地 DB 中已有的 fdcId，只入库缺失的记录。
 *
 * 用法:
 *   node scripts/sync-usda-missing/sync.mjs [--dry-run] [--limit=500]
 *
 * 环境变量（自动从 apps/api-server/.env 读取）:
 *   USDA_API_KEY  DATABASE_URL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { Client } from 'pg';

// ─── 读取 .env ────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../apps/api-server/.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) envVars[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    });
}
const USDA_API_KEY = envVars.USDA_API_KEY || process.env.USDA_API_KEY;
const DATABASE_URL = envVars.DATABASE_URL || process.env.DATABASE_URL;

if (!USDA_API_KEY) {
  console.error('❌ USDA_API_KEY not found');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

// ─── 命令行参数 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const IMPORT_LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;

console.log(`\n🚀 USDA Missing Data Sync`);
console.log(`   DRY_RUN=${DRY_RUN}  IMPORT_LIMIT=${IMPORT_LIMIT}`);
console.log(`   API_KEY=${USDA_API_KEY.slice(0, 6)}...`);

// ─── HTTP helper（带重试）────────────────────────────────────────────────────
async function httpGet(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await new Promise((resolve, reject) => {
        https
          .get(url, (res) => {
            let buf = '';
            res.on('data', (chunk) => (buf += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: buf }));
          })
          .on('error', reject);
      });
      if (data.status === 503 || data.status === 429) {
        const wait = attempt * 5000;
        console.log(`\n  ⚠️  HTTP ${data.status}, retrying in ${wait / 1000}s (attempt ${attempt}/${retries})...`);
        await sleep(wait);
        continue;
      }
      try {
        return JSON.parse(data.body);
      } catch (e) {
        throw new Error(`JSON parse error: ${e.message}\nRaw: ${data.body.slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(attempt * 3000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── USDA nutrientId → 字段映射 ───────────────────────────────────────────────
const NUTRIENT_MAP = {
  1008: 'calories',
  1003: 'protein',
  1004: 'fat',
  1005: 'carbs',
  1079: 'fiber',
  2000: 'sugar',
  1258: 'saturated_fat',
  1257: 'trans_fat',
  1253: 'cholesterol',
  1093: 'sodium',
  1092: 'potassium',
  1087: 'calcium',
  1089: 'iron',
  1106: 'vitamin_a',
  1162: 'vitamin_c',
  1114: 'vitamin_d',
  1109: 'vitamin_e',
  1178: 'vitamin_b12',
  1177: 'folate',
  1095: 'zinc',
  1090: 'magnesium',
  1091: 'phosphorus',
};

const CATEGORY_MAP = {
  'Beef Products': 'protein',
  'Pork Products': 'protein',
  'Lamb, Veal, and Game Products': 'protein',
  'Poultry Products': 'protein',
  'Finfish and Shellfish Products': 'protein',
  'Sausages and Luncheon Meats': 'protein',
  'Legumes and Legume Products': 'protein',
  'Vegetables and Vegetable Products': 'veggie',
  'Fruits and Fruit Juices': 'fruit',
  'Cereal Grains and Pasta': 'grain',
  'Breakfast Cereals': 'grain',
  'Baked Products': 'grain',
  'Dairy and Egg Products': 'dairy',
  Beverages: 'beverage',
  Snacks: 'snack',
  Sweets: 'snack',
  'Spices and Herbs': 'condiment',
  'Fats and Oils': 'fat',
  'Nut and Seed Products': 'fat',
  'Soups, Sauces, and Gravies': 'composite',
  'Meals, Entrees, and Side Dishes': 'composite',
  'Fast Foods': 'composite',
  'Restaurant Foods': 'composite',
  'Baby Foods': 'composite',
  'American Indian/Alaska Native Foods': 'composite',
};

// ─── 从 USDA search API 获取一页数据 ─────────────────────────────────────────
async function fetchUsdaPage(pageNumber, pageSize = 200, dataTypes = ['Foundation', 'SR Legacy']) {
  const params = new URLSearchParams({
    api_key: USDA_API_KEY,
    query: '*',
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
    dataType: dataTypes.join(','),
  });
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params}`;
  const data = await httpGet(url);
  return {
    foods: data.foods || [],
    totalHits: data.totalHits || 0,
    totalPages: data.totalPages || 0,
  };
}

// ─── 解析 nutrients ────────────────────────────────────────────────────────────
function parseNutrients(foodNutrients = []) {
  const result = {};
  for (const n of foodNutrients) {
    const nid = n.nutrientId || n.nutrient?.id;
    const val = n.value ?? n.amount;
    if (nid && NUTRIENT_MAP[nid] && val != null) {
      result[NUTRIENT_MAP[nid]] = val;
    }
  }
  return result;
}

// ─── 获取 foods 表的列信息 ────────────────────────────────────────────────────
async function getTableColumns(client, tableName) {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position`,
    [tableName]
  );
  return new Set(res.rows.map((r) => r.column_name));
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✅ Connected to local DB\n');

  // 1. 获取 foods 表列信息（处理字段差异）
  const columns = await getTableColumns(client, 'foods');
  console.log(`📊 foods table has ${columns.size} columns`);

  // 2. 获取 DB 中已有的所有 USDA fdcId，以及当前最大 code 序号
  const existingRes = await client.query(
    `SELECT primary_source_id FROM foods WHERE primary_source='usda'`
  );
  const existingIds = new Set(existingRes.rows.map((r) => r.primary_source_id));
  console.log(`📦 Already in DB: ${existingIds.size} USDA foods`);

  const maxCodeRes = await client.query(
    `SELECT MAX(SUBSTRING(code, 8)::bigint) as maxnum FROM foods WHERE code ~ '^FOOD_G_'`
  );
  let codeCounter = parseInt(maxCodeRes.rows[0].maxnum || '0') + 1;
  console.log(`🔢 Next code sequence starts at: FOOD_G_${String(codeCounter).padStart(5, '0')}\n`);

  // 3. 全量拉取 USDA，收集缺失的食物
  const PAGE_SIZE = 200;
  let totalHits = 0;
  let pageNumber = 1;
  const missing = []; // { fdcId, food }

  console.log('🔍 Scanning USDA API (Foundation + SR Legacy)...\n');

  while (true) {
    process.stdout.write(`  Page ${pageNumber}... `);
    let result;
    try {
      result = await fetchUsdaPage(pageNumber, PAGE_SIZE);
    } catch (e) {
      console.error(`\n❌ Failed page ${pageNumber}: ${e.message}`);
      break;
    }

    if (pageNumber === 1) {
      totalHits = result.totalHits;
      console.log(`\n  📡 USDA total: ${totalHits} foods (${result.totalPages} pages)\n`);
      process.stdout.write(`  Page ${pageNumber}... `);
    }

    if (result.foods.length === 0) {
      console.log(`empty, stopping.`);
      break;
    }

    let newCount = 0;
    for (const food of result.foods) {
      const fdcId = String(food.fdcId);
      if (!existingIds.has(fdcId)) {
        missing.push(food);
        newCount++;
      }
    }

    console.log(`fetched=${result.foods.length}, new=${newCount}, cumulative missing=${missing.length}`);

    if (result.foods.length < PAGE_SIZE || (IMPORT_LIMIT !== Infinity && missing.length >= IMPORT_LIMIT)) {
      break;
    }
    pageNumber++;
    await sleep(400); // USDA rate limit: ~1000 req/hour
  }

  console.log(`\n📊 Summary: ${totalHits} total USDA, ${existingIds.size} in DB, ${missing.length} missing\n`);

  if (missing.length === 0) {
    console.log('✅ Nothing to import!');
    await client.end();
    return;
  }

  if (DRY_RUN) {
    console.log(`🧪 DRY RUN — would import ${missing.length} foods`);
    console.log('   Sample (first 10):');
    missing.slice(0, 10).forEach((f) => {
      console.log(`     fdcId=${f.fdcId}  "${f.description}"  [${f.dataType}] [${f.foodCategory || 'N/A'}]`);
    });
    await client.end();
    return;
  }

  // 4. 入库缺失食物
  const toImport = IMPORT_LIMIT !== Infinity ? missing.slice(0, IMPORT_LIMIT) : missing;
  console.log(`⬆️  Importing ${toImport.length} missing foods...\n`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const errorLog = [];

  for (let i = 0; i < toImport.length; i++) {
    const food = toImport[i];
    const fdcId = String(food.fdcId);
    const nutrients = parseNutrients(food.foodNutrients || []);
    const category = CATEGORY_MAP[food.foodCategory] || null;

    // 构建插入字段（只用表中存在的列）
    const foodCode = `FOOD_G_${String(codeCounter).padStart(5, '0')}`;
    codeCounter++;

    const row = {
      code: foodCode,
      name: (food.description || '').slice(0, 255),
      primary_source: 'usda',
      primary_source_id: fdcId,
      status: 'active',
      calories: nutrients.calories ?? 0,
      category: CATEGORY_MAP[food.foodCategory] || 'composite', // NOT NULL fallback
      commonality_score: 30,   // 新导入的给较低初始分
      ingredient_list: '{}',   // NOT NULL, 空数组
      data_completeness: 0,
      enrichment_status: 'pending',
      review_status: 'pending',
      confidence: 1,
      is_verified: false,
      search_weight: 100,
      data_version: 1,
    };

    // 可选营养字段
    const optionalNutrients = ['protein','fat','carbs','fiber','sugar','sodium','potassium','calcium','iron',
      'saturated_fat','trans_fat','cholesterol','vitamin_a','vitamin_c','vitamin_d','vitamin_e',
      'vitamin_b12','folate','zinc','magnesium','phosphorus'];
    for (const field of optionalNutrients) {
      if (columns.has(field) && nutrients[field] != null) {
        row[field] = nutrients[field];
      }
    }

    if (columns.has('food_group') && food.foodCategory) row.food_group = food.foodCategory;

    const keys = Object.keys(row);
    const values = Object.values(row);
    const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');

    try {
      // UNIQUE constraint is on (name). If name conflicts, append fdcId suffix.
      const result = await client.query(
        `INSERT INTO foods (${keys.join(', ')}) VALUES (${placeholders}) ON CONFLICT (name) DO NOTHING`,
        values
      );
      if (result.rowCount === 0) {
        // Name collision — retry with unique suffix
        const nameIdx = keys.indexOf('name');
        values[nameIdx] = `${row.name} (${fdcId})`;
        const result2 = await client.query(
          `INSERT INTO foods (${keys.join(', ')}) VALUES (${placeholders}) ON CONFLICT (name) DO NOTHING`,
          values
        );
        if (result2.rowCount > 0) inserted++;
        else skipped++;
      } else {
        inserted++;
      }
    } catch (e) {
      errors++;
      errorLog.push(`fdcId=${fdcId}: ${e.message}`);
    }

    if ((i + 1) % 100 === 0 || i === toImport.length - 1) {
      process.stdout.write(`\r  Progress: ${i + 1}/${toImport.length} (inserted=${inserted}, errors=${errors})   `);
    }
  }

  console.log(`\n\n✅ Done!`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Skipped (conflict): ${toImport.length - inserted - errors}`);
  console.log(`   Errors: ${errors}`);

  if (errorLog.length > 0) {
    console.log('\n❌ Errors:');
    errorLog.slice(0, 20).forEach((e) => console.log('  ', e));
  }

  // 5. 最终统计
  const finalRes = await client.query(`SELECT COUNT(*) FROM foods WHERE primary_source='usda'`);
  console.log(`\n📦 Final USDA count in DB: ${finalRes.rows[0].count}`);

  await client.end();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
