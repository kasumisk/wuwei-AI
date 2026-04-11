-- V6.3 P2-9: Add exercise_schedule field to user_profiles
-- Stores weekly exercise plan as JSONB, e.g. { "mon": { "startHour": 7, "durationHours": 1 }, ... }
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "exercise_schedule" JSONB DEFAULT '{}';
