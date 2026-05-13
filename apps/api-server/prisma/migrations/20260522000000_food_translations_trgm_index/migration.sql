-- food_translations pg_trgm GIN indexes for multilingual food name matching
-- Enables efficient trigram similarity search on translated food names

CREATE INDEX IF NOT EXISTS idx_food_translations_name_trgm
  ON food_translations USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_food_translations_aliases_trgm
  ON food_translations USING gin (aliases gin_trgm_ops);
