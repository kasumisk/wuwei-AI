-- ============================================================================
-- Migration: ARB 2026-04 — Drop 15 duplicate / ghost enums
-- ============================================================================
-- Context:
--   ARB review (docs/ARCHITECTURE_REVIEW_BOARD_2026-04.md) identified 15 enum
--   types that were defined in schema.prisma but NOT referenced by any model
--   field. They are leftover from earlier Prisma introspection passes.
--
-- Safety:
--   - No table is dropped.
--   - No column is dropped.
--   - No row is touched.
--   - Each DROP TYPE has been verified: the enum has zero column references.
--   - DROP TYPE IF EXISTS makes this idempotent and safe to re-run.
--
-- Rollback:
--   Recreate the enums via a fresh migration if absolutely needed (none of
--   them are referenced today, so rollback is rarely useful).
-- ============================================================================

-- 1. Activity / admin / app-user duplicates --------------------------------
DROP TYPE IF EXISTS "activity_level_enum";
DROP TYPE IF EXISTS "admin_role_enum";
DROP TYPE IF EXISTS "admin_user_status_enum";
DROP TYPE IF EXISTS "app_user_auth_type_enum";
DROP TYPE IF EXISTS "app_user_status_enum";

-- 2. Capability / currency / model-status duplicates -----------------------
DROP TYPE IF EXISTS "capability_type_enum";
DROP TYPE IF EXISTS "currency_enum";
DROP TYPE IF EXISTS "model_status_enum";

-- 3. Meal / record-source duplicates ---------------------------------------
DROP TYPE IF EXISTS "meal_type_enum";
DROP TYPE IF EXISTS "record_source_enum";

-- 4. Permission / http-method duplicates -----------------------------------
DROP TYPE IF EXISTS "http_method_enum";
DROP TYPE IF EXISTS "permission_status_enum";
DROP TYPE IF EXISTS "permission_type_enum";

-- 5. Provider duplicates ---------------------------------------------------
DROP TYPE IF EXISTS "provider_status_enum";
DROP TYPE IF EXISTS "provider_type_enum";
