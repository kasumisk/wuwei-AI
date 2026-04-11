-- V6.5 Phase 2I: FK 约束补齐
-- 执行前需清理孤儿数据

-- 1. daily_plans.user_id → app_users.id (CASCADE)
DELETE FROM daily_plans WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE daily_plans
  ADD CONSTRAINT fk_daily_plans_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- 2. user_behavior_profiles.user_id → app_users.id (CASCADE)
DELETE FROM user_behavior_profiles WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE user_behavior_profiles
  ADD CONSTRAINT fk_behavior_profiles_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- 3. strategy_assignment.strategy_id → strategy.id (SET NULL)
-- 先将 strategy_id NOT NULL 改为 NULLABLE
ALTER TABLE strategy_assignment ALTER COLUMN strategy_id DROP NOT NULL;
-- 清理孤儿数据
UPDATE strategy_assignment SET strategy_id = NULL WHERE strategy_id NOT IN (SELECT id FROM strategy);
ALTER TABLE strategy_assignment
  ADD CONSTRAINT fk_strategy_assignment_strategy
  FOREIGN KEY (strategy_id) REFERENCES strategy(id) ON DELETE SET NULL;

-- 4. strategy_assignment.user_id → app_users.id (CASCADE)
DELETE FROM strategy_assignment WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE strategy_assignment
  ADD CONSTRAINT fk_strategy_assignment_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- 5. notification.user_id → app_users.id (CASCADE)
DELETE FROM notification WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE notification
  ADD CONSTRAINT fk_notification_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- 6. weight_history.user_id → app_users.id (CASCADE)
DELETE FROM weight_history WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE weight_history
  ADD CONSTRAINT fk_weight_history_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
