/**
 * V8.2 Food Infrastructure Refactor — verification script
 *
 * Run AFTER `prisma migrate deploy` to ensure data was migrated correctly.
 * Exits with non-zero code on any mismatch.
 *
 * Usage:
 *   pnpm tsx scripts/refactor/verify-food-infra.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CountRow { count: bigint }

async function scalarCount(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

async function check(label: string, lhs: number, rhs: number, tolerance = 0): Promise<boolean> {
  const diff = Math.abs(lhs - rhs);
  const ok = diff <= tolerance;
  const status = ok ? 'OK ' : 'FAIL';
  console.log(`[${status}] ${label}: lhs=${lhs} rhs=${rhs} diff=${diff}`);
  return ok;
}

async function pgvectorAvailable(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS exists`,
  );
  return Boolean(rows[0]?.exists);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='${table}'
          AND column_name='${column}'
     ) AS exists`,
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  let allOk = true;

  // ─── Schema sanity ──────────────────────────────────────────────────────
  for (const col of [
    'embedding',
    'embedding_v5',
    'embedding_updated_at',
    'failed_fields',
    'field_sources',
    'field_confidence',
  ]) {
    const exists = await columnExists('foods', col);
    const ok = !exists;
    console.log(`[${ok ? 'OK ' : 'FAIL'}] foods.${col} dropped (exists=${exists})`);
    allOk = allOk && ok;
  }

  // ─── Row counts: foods unchanged ────────────────────────────────────────
  const foodsCount = await scalarCount(`SELECT COUNT(*)::bigint AS count FROM foods`);
  console.log(`[INFO] foods row count = ${foodsCount}`);

  // ─── Embeddings ─────────────────────────────────────────────────────────
  // We can't compare to original counts (columns are gone post-migration);
  // instead we sanity-check that food_embeddings rows have valid foreign keys
  // and dimensions are coherent.
  const legacyCount = await scalarCount(
    `SELECT COUNT(*)::bigint AS count FROM food_embeddings WHERE model_name='legacy_v4'`,
  );
  const featureV5Count = await scalarCount(
    `SELECT COUNT(*)::bigint AS count FROM food_embeddings WHERE model_name='feature_v5'`,
  );
  const openaiV5Count = await scalarCount(
    `SELECT COUNT(*)::bigint AS count FROM food_embeddings WHERE model_name='openai_v5'`,
  );
  console.log(
    `[INFO] food_embeddings legacy_v4=${legacyCount} feature_v5=${featureV5Count} openai_v5=${openaiV5Count}`,
  );

  // legacy must have non-empty arrays
  const legacyBad = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM food_embeddings
     WHERE model_name='legacy_v4'
       AND (vector_legacy IS NULL OR array_length(vector_legacy,1) IS NULL OR dimension <= 0)
  `);
  allOk = (await check('legacy_v4 rows have non-empty vector_legacy', legacyBad, 0)) && allOk;

  if (await pgvectorAvailable()) {
    // feature_v5：computeFoodEmbedding 96 维特征向量（当前推荐主用）
    const featureV5Bad = await scalarCount(
      `SELECT COUNT(*)::bigint AS count FROM food_embeddings
        WHERE model_name='feature_v5' AND (vector IS NULL OR dimension <= 0)`,
    );
    allOk = (await check('feature_v5 rows have valid vector + dimension', featureV5Bad, 0)) && allOk;

    // openai_v5：1536 维 OpenAI text-embedding-3-small（预留）
    const openaiV5Bad = await scalarCount(
      `SELECT COUNT(*)::bigint AS count FROM food_embeddings
        WHERE model_name='openai_v5' AND (vector IS NULL OR dimension <> 1536)`,
    );
    allOk = (await check('openai_v5 rows have valid 1536-dim vector', openaiV5Bad, 0)) && allOk;
  }

  // FK orphans
  const orphanEmb = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM food_embeddings fe
     LEFT JOIN foods f ON f.id = fe.food_id
     WHERE f.id IS NULL
  `);
  allOk = (await check('food_embeddings has no orphan rows', orphanEmb, 0)) && allOk;

  // Unique (food_id, model_name)
  const dupEmb = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT food_id, model_name, COUNT(*) AS c
        FROM food_embeddings
       GROUP BY food_id, model_name
      HAVING COUNT(*) > 1
    ) dup
  `);
  allOk = (await check('food_embeddings (food_id, model_name) is unique', dupEmb, 0)) && allOk;

  // ─── Field provenance ───────────────────────────────────────────────────
  const provSuccessKeys = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM food_field_provenance WHERE status='success'
  `);
  const provFailedKeys = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM food_field_provenance WHERE status='failed'
  `);
  console.log(`[INFO] provenance success=${provSuccessKeys} failed=${provFailedKeys}`);

  const successNullMeta = await scalarCount(`
    SELECT COUNT(*)::bigint AS count
      FROM food_field_provenance
     WHERE status='success' AND source IS NULL
  `);
  allOk = (await check('food_field_provenance success rows have source', successNullMeta, 0)) && allOk;

  // FK orphans
  const orphanProv = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM food_field_provenance p
     LEFT JOIN foods f ON f.id = p.food_id
     WHERE f.id IS NULL
  `);
  allOk = (await check('food_field_provenance has no orphan rows', orphanProv, 0)) && allOk;

  // Unique constraint
  const dupProv = await scalarCount(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT food_id, field_name, source, COUNT(*) AS c
        FROM food_field_provenance
       GROUP BY food_id, field_name, source
      HAVING COUNT(*) > 1
    ) dup
  `);
  allOk = (await check('food_field_provenance (food_id, field_name, source) unique', dupProv, 0)) && allOk;

  // ─── Recommendation profile ─────────────────────────────────────────────
  const profileCount = await scalarCount(`SELECT COUNT(*)::bigint AS count FROM food_recommendation_profile`);
  allOk = (await check('food_recommendation_profile row count == foods count', profileCount, foodsCount)) && allOk;

  // ─── Final ──────────────────────────────────────────────────────────────
  console.log('');
  if (allOk) {
    console.log('===== ALL CHECKS OK =====');
    process.exit(0);
  } else {
    console.error('===== VERIFICATION FAILED =====');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
}).finally(() => prisma.$disconnect());
