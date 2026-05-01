-- C1-fix: Remove DB-level defaults from UserProfiles.regionCode, timezone, locale.
--
-- These defaults caused NULL values (= user hasn't set a region/timezone) to be
-- silently filled with US/America/New_York/en-US at the DB layer, hiding the gap
-- from application-level monitoring and producing wrong recommendations for
-- non-US users who had not completed onboarding.
--
-- Business-layer fallback is now handled exclusively in
-- pipeline-context-factory.service.ts (with structured structured warn logs).
--
-- timezone is also changed from NOT NULL → nullable, matching the intent that
-- a missing value should be distinguishable from an explicit user choice.

ALTER TABLE "UserProfiles"
  ALTER COLUMN "region_code" DROP DEFAULT,
  ALTER COLUMN "locale"      DROP DEFAULT,
  ALTER COLUMN "timezone"    DROP DEFAULT,
  ALTER COLUMN "timezone"    DROP NOT NULL;
