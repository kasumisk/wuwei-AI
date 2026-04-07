import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGamificationTables1749000000000 implements MigrationInterface {
  name = 'AddGamificationTables1749000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        icon VARCHAR(10),
        category VARCHAR(30),
        threshold INT NOT NULL,
        reward_type VARCHAR(30),
        reward_value INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        achievement_id UUID NOT NULL REFERENCES achievements(id),
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, achievement_id)
      );

      CREATE TABLE IF NOT EXISTS challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(100) NOT NULL,
        description TEXT,
        type VARCHAR(30),
        duration_days INT NOT NULL,
        rules JSONB,
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS user_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        challenge_id UUID NOT NULL REFERENCES challenges(id),
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        current_progress INT DEFAULT 0,
        max_progress INT NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        completed_at TIMESTAMP
      );

      -- 种子数据：成就
      INSERT INTO achievements (code, name, description, icon, category, threshold, reward_type, reward_value) VALUES
        ('streak_3', '三天坚持', '连续3天达标', '🔥', 'streak', 3, 'badge', 10),
        ('streak_7', '一周达人', '连续7天达标', '⭐', 'streak', 7, 'badge', 30),
        ('streak_14', '两周勇士', '连续14天达标', '🏅', 'streak', 14, 'badge', 60),
        ('streak_30', '月度冠军', '连续30天达标', '🏆', 'streak', 30, 'badge', 150),
        ('records_10', '记录新手', '累计记录10餐', '📝', 'record', 10, 'badge', 10),
        ('records_50', '记录达人', '累计记录50餐', '📋', 'record', 50, 'badge', 30),
        ('records_100', '记录大师', '累计记录100餐', '📊', 'record', 100, 'badge', 60),
        ('healthy_rate_80', '健康饮食家', '健康记录率达80%', '💚', 'milestone', 80, 'badge', 50),
        ('first_analyze', '初次识别', '完成首次AI分析', '📸', 'milestone', 1, 'badge', 5),
        ('first_plan', '计划达人', '完成首次每日计划', '📅', 'milestone', 1, 'badge', 5)
      ON CONFLICT (code) DO NOTHING;

      -- 种子数据：挑战
      INSERT INTO challenges (title, description, type, duration_days, rules, is_active) VALUES
        ('无奶茶周', '7天不喝奶茶', 'no_boba_7d', 7, '{"avoidFoods": ["奶茶", "珍珠奶茶", "波霸"]}', true),
        ('低碳晚餐', '连续5天晚餐低碳水', 'low_carb_dinner', 5, '{"mealType": "dinner", "maxCarb": 100}', true),
        ('高蛋白周', '7天每日蛋白质达标', 'high_protein_7d', 7, '{"minProteinMeals": 2}', true),
        ('早餐不缺席', '连续7天记录早餐', 'breakfast_streak', 7, '{"mealType": "breakfast", "requireRecord": true}', true)
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS user_challenges;
      DROP TABLE IF EXISTS challenges;
      DROP TABLE IF EXISTS user_achievements;
      DROP TABLE IF EXISTS achievements;
    `);
  }
}
