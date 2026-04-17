import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

type ScenarioName = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';

type IssueType = '分析错误' | '解释不合理' | '决策错误' | '教练无用';

interface DebugIssue {
  scenario: ScenarioName;
  type: IssueType;
  message: string;
  rootCause: string;
}

interface ScenarioConfig {
  name: ScenarioName;
  deviceId: string;
  declared: Record<string, unknown>;
  preference: Record<string, unknown>;
  record: Record<string, unknown>;
  analyzeText: {
    text: string;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    locale: 'zh-CN' | 'en-US' | 'ja-JP';
  };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe('AI饮食分析+决策+AI教练 全链路自动化调试', () => {
  let app: INestApplication<App>;
  const issues: DebugIssue[] = [];

  const scenarios: ScenarioConfig[] = [
    {
      name: 'fat_loss',
      deviceId: `debug-fat-loss-${Date.now()}`,
      declared: {
        gender: 'female',
        birthYear: 1996,
        heightCm: 162,
        weightKg: 70,
        targetWeightKg: 58,
        activityLevel: 'light',
        goal: 'fat_loss',
        mealsPerDay: 3,
        takeoutFrequency: 'often',
        canCook: true,
        foodPreferences: ['spicy', 'meat'],
        dietaryRestrictions: [],
        allergens: ['peanut'],
        healthConditions: ['fatty_liver'],
        weakTimeSlots: ['evening'],
        bingeTriggers: ['stress'],
        discipline: 'medium',
        cookingSkillLevel: 'basic',
        cuisinePreferences: ['sichuan', 'chinese'],
        sleepQuality: 'fair',
        stressLevel: 'high',
        hydrationGoal: 2200,
        mealTimingPreference: 'late_eater',
        kitchenProfile: {
          hasOven: false,
          hasMicrowave: true,
          hasAirFryer: true,
          hasRiceCooker: true,
          primaryStove: 'gas',
        },
      },
      preference: {
        popularityPreference: 'balanced',
        cookingEffort: 'quick',
        budgetSensitivity: 'budget',
        mealPattern: 'standard_three',
        flavorOpenness: 'moderate',
        diversityTolerance: 'medium',
      },
      record: {
        foods: [
          {
            name: '炸鸡腿',
            calories: 520,
            quantity: '1份',
            protein: 28,
            fat: 32,
            carbs: 38,
          },
          {
            name: '米饭',
            calories: 280,
            quantity: '1碗',
            protein: 5,
            fat: 1,
            carbs: 62,
          },
        ],
        totalCalories: 800,
        mealType: 'dinner',
        totalProtein: 33,
        totalFat: 33,
        totalCarbs: 100,
      },
      analyzeText: {
        text: '花生米一份',
        mealType: 'snack',
        locale: 'zh-CN',
      },
    },
    {
      name: 'muscle_gain',
      deviceId: `debug-muscle-${Date.now()}`,
      declared: {
        gender: 'male',
        birthYear: 1998,
        heightCm: 178,
        weightKg: 74,
        targetWeightKg: 80,
        activityLevel: 'active',
        goal: 'muscle_gain',
        mealsPerDay: 4,
        takeoutFrequency: 'sometimes',
        canCook: true,
        foodPreferences: ['meat'],
        dietaryRestrictions: [],
        allergens: [],
        healthConditions: [],
        weakTimeSlots: ['afternoon'],
        bingeTriggers: ['boredom'],
        discipline: 'high',
        cookingSkillLevel: 'intermediate',
        cuisinePreferences: ['western', 'japanese'],
        sleepQuality: 'good',
        stressLevel: 'low',
        hydrationGoal: 3000,
        mealTimingPreference: 'early_bird',
        kitchenProfile: {
          hasOven: true,
          hasMicrowave: true,
          hasAirFryer: true,
          hasRiceCooker: true,
          primaryStove: 'induction',
        },
      },
      preference: {
        popularityPreference: 'adventurous',
        cookingEffort: 'moderate',
        budgetSensitivity: 'moderate',
        mealPattern: 'frequent_small',
        flavorOpenness: 'adventurous',
        diversityTolerance: 'high',
      },
      record: {
        foods: [
          {
            name: '鸡胸肉',
            calories: 220,
            quantity: '200g',
            protein: 42,
            fat: 4,
            carbs: 0,
          },
          {
            name: '燕麦',
            calories: 180,
            quantity: '1碗',
            protein: 6,
            fat: 3,
            carbs: 32,
          },
        ],
        totalCalories: 400,
        mealType: 'breakfast',
        totalProtein: 48,
        totalFat: 7,
        totalCarbs: 32,
      },
      analyzeText: {
        text: '鸡胸肉加鸡蛋和燕麦',
        mealType: 'lunch',
        locale: 'zh-CN',
      },
    },
    {
      name: 'health',
      deviceId: `debug-health-${Date.now()}`,
      declared: {
        gender: 'male',
        birthYear: 1982,
        heightCm: 175,
        weightKg: 82,
        activityLevel: 'moderate',
        goal: 'health',
        mealsPerDay: 3,
        takeoutFrequency: 'sometimes',
        canCook: true,
        foodPreferences: ['light'],
        dietaryRestrictions: ['low_sodium'],
        allergens: ['shellfish'],
        healthConditions: ['hypertension', 'diabetes_type2'],
        weakTimeSlots: ['evening'],
        bingeTriggers: ['social'],
        discipline: 'medium',
        cookingSkillLevel: 'advanced',
        cuisinePreferences: ['chinese', 'mediterranean'],
        sleepQuality: 'fair',
        stressLevel: 'medium',
        hydrationGoal: 2500,
        mealTimingPreference: 'standard',
        kitchenProfile: {
          hasOven: true,
          hasMicrowave: true,
          hasAirFryer: false,
          hasRiceCooker: true,
          primaryStove: 'gas',
        },
      },
      preference: {
        popularityPreference: 'popular',
        cookingEffort: 'quick',
        budgetSensitivity: 'moderate',
        mealPattern: 'standard_three',
        flavorOpenness: 'conservative',
        diversityTolerance: 'low',
      },
      record: {
        foods: [
          {
            name: '咸鱼',
            calories: 200,
            quantity: '100g',
            protein: 30,
            fat: 8,
            carbs: 0,
          },
          {
            name: '泡菜',
            calories: 30,
            quantity: '1份',
            protein: 2,
            fat: 1,
            carbs: 5,
          },
        ],
        totalCalories: 230,
        mealType: 'lunch',
        totalProtein: 32,
        totalFat: 9,
        totalCarbs: 5,
      },
      analyzeText: {
        text: '咸鱼加泡菜',
        mealType: 'dinner',
        locale: 'zh-CN',
      },
    },
    {
      name: 'habit',
      deviceId: `debug-habit-${Date.now()}`,
      declared: {
        gender: 'male',
        birthYear: 2001,
        heightCm: 176,
        weightKg: 69,
        activityLevel: 'light',
        goal: 'habit',
        mealsPerDay: 3,
        takeoutFrequency: 'often',
        canCook: false,
        foodPreferences: ['sweet', 'fried'],
        dietaryRestrictions: [],
        allergens: [],
        healthConditions: [],
        weakTimeSlots: ['midnight'],
        bingeTriggers: ['stress', 'emotion'],
        discipline: 'low',
        cookingSkillLevel: 'beginner',
        cuisinePreferences: ['fast_food', 'chinese'],
        sleepQuality: 'poor',
        stressLevel: 'high',
        hydrationGoal: 1800,
        mealTimingPreference: 'late_eater',
        kitchenProfile: {
          hasOven: false,
          hasMicrowave: true,
          hasAirFryer: false,
          hasRiceCooker: false,
          primaryStove: 'none',
        },
      },
      preference: {
        popularityPreference: 'popular',
        cookingEffort: 'quick',
        budgetSensitivity: 'budget',
        mealPattern: 'intermittent_fasting',
        flavorOpenness: 'moderate',
        diversityTolerance: 'low',
      },
      record: {
        foods: [
          {
            name: '奶茶',
            calories: 380,
            quantity: '1杯',
            protein: 3,
            fat: 12,
            carbs: 62,
          },
          {
            name: '炸鸡',
            calories: 500,
            quantity: '1份',
            protein: 26,
            fat: 30,
            carbs: 35,
          },
        ],
        totalCalories: 880,
        mealType: 'snack',
        totalProtein: 29,
        totalFat: 42,
        totalCarbs: 97,
      },
      analyzeText: {
        text: '晚上吃了一份炸鸡和奶茶',
        mealType: 'snack',
        locale: 'zh-CN',
      },
    },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('执行 4 个场景全链路并评估 Analyze/Explain/Decide/Coach', async () => {
    const http = request(app.getHttpServer());

    for (const scenario of scenarios) {
      // Step 1. 获取用户（匿名登录）
      const loginRes = await http
        .post('/app/auth/anonymous')
        .send({ deviceId: scenario.deviceId })
        .expect(200);

      const token = loginRes.body?.data?.token as string;
      if (!token) {
        issues.push({
          scenario: scenario.name,
          type: '分析错误',
          message: '匿名登录未返回 token',
          rootCause: '认证接口响应结构异常或鉴权链问题',
        });
        continue;
      }

      // Step 1. 更新画像与偏好（覆盖用户档案/偏好/生活方式）
      await http
        .patch('/app/user-profile/declared')
        .set(authHeader(token))
        .send(scenario.declared)
        .expect(200);

      await http
        .put('/app/user-profile/recommendation-preferences')
        .set(authHeader(token))
        .send(scenario.preference)
        .expect(200);

      // Step 1. 保存真实饮食记录
      await http
        .post('/app/food/records')
        .set(authHeader(token))
        .send(scenario.record)
        .expect(201);

      // Step 1. 触发文本分析（Analyze+Decide+Coach）
      const analyzeRes = await http
        .post('/app/food/analyze-text')
        .set(authHeader(token))
        .send(scenario.analyzeText)
        .expect(200);

      // Step 1. 获取今日评分（Explain + 状态）
      const nutritionRes = await http
        .get('/app/food/nutrition-score')
        .set(authHeader(token))
        .expect(200);

      // Step 1. 获取推荐（推荐系统链路）
      const suggestionRes = await http
        .get('/app/food/meal-suggestion')
        .set(authHeader(token))
        .expect(200);

      const analysisData = analyzeRes.body?.data;
      const nutritionData = nutritionRes.body?.data;
      const suggestionData = suggestionRes.body?.data;

      // Step 2. Analyze 层校验
      const totals = analysisData?.totals;
      if (
        !totals ||
        typeof totals.calories !== 'number' ||
        typeof totals.protein !== 'number' ||
        typeof totals.fat !== 'number' ||
        typeof totals.carbs !== 'number'
      ) {
        issues.push({
          scenario: scenario.name,
          type: '分析错误',
          message: 'analyze-text 未返回完整宏量营养 totals',
          rootCause: '分析聚合器字段映射缺失或结果裁剪过度',
        });
      }

      // Step 2. Explain 层校验
      const explanation = analysisData?.explanation;
      if (!explanation || !explanation.summary) {
        issues.push({
          scenario: scenario.name,
          type: '解释不合理',
          message: '分析结果缺少 explanation.summary',
          rootCause: '解释生成器未产出摘要或响应结构缺失',
        });
      }

      // Step 2. Decide 层校验
      const decision = analysisData?.decision;
      const recommendation = decision?.recommendation as string | undefined;
      if (
        !recommendation ||
        !['recommend', 'caution', 'avoid'].includes(recommendation)
      ) {
        issues.push({
          scenario: scenario.name,
          type: '决策错误',
          message: `决策 recommendation 非法: ${String(recommendation)}`,
          rootCause: '决策引擎返回枚举与前端约定不一致',
        });
      }

      if (scenario.name === 'fat_loss' && recommendation === 'recommend') {
        issues.push({
          scenario: scenario.name,
          type: '决策错误',
          message: '花生过敏用户对花生分析结果为 recommend（应至少 caution）',
          rootCause: '过敏原检测未在 analyze-text 决策链生效',
        });
      }

      if (scenario.name === 'health' && recommendation === 'recommend') {
        issues.push({
          scenario: scenario.name,
          type: '决策错误',
          message: '低钠+高血压场景对高钠食物返回 recommend（应至少 caution）',
          rootCause: '饮食限制/健康条件约束在决策链中权重不足或未生效',
        });
      }

      // Step 2. Coach 层校验
      const coachText =
        explanation?.recommendation ||
        decision?.advice ||
        nutritionData?.statusExplanation ||
        nutritionData?.feedback?.daily;

      if (!coachText || String(coachText).trim().length < 8) {
        issues.push({
          scenario: scenario.name,
          type: '教练无用',
          message: '教练建议为空或过短，不具备可执行性',
          rootCause: '教练文案生成缺少兜底策略',
        });
      }

      if (!nutritionData?.statusLabel || !nutritionData?.breakdown) {
        issues.push({
          scenario: scenario.name,
          type: '解释不合理',
          message: 'nutrition-score 缺少 statusLabel 或 breakdown',
          rootCause: '营养评分接口响应结构回归',
        });
      }

      if (!suggestionData?.suggestion?.foods && !suggestionData?.foods) {
        issues.push({
          scenario: scenario.name,
          type: '教练无用',
          message: 'meal-suggestion 未返回可执行食物建议',
          rootCause: '推荐装配器输出结构不稳定',
        });
      }
    }

    expect(issues).toEqual([]);
  }, 180000);
});
