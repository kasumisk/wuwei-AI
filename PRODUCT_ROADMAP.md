# 无畏健康 AI 饮食决策系统 — 完整产品路线图 & 实施方案

> **版本**：v2.0 | **日期**：2026-04-07
> **最后更新**：2026-04-07 — V1~V5 全部实现完成，已部署生产环境
>
> **产品使命**：用 AI 改变用户饮食行为的系统，不是卡路里计算器。
>
> **核心判断标准**：用户看完建议后，能不能立刻做出行动？

---

## 目录

- [一、当前系统现状（已实现）](#一当前系统现状已实现)
- [二、版本演进路线（V1 → V5）](#二版本演进路线v1--v5)
- [三、V1：AI 饮食决策系统（首页改版）](#三v1ai-饮食决策系统首页改版)
- [四、V2：日计划引擎（饮食操作系统）](#四v2日计划引擎饮食操作系统)
- [五、V3：行为建模系统（理解用户）](#五v3行为建模系统理解用户)
- [六、V4：游戏化引擎（让人上瘾）](#六v4游戏化引擎让人上瘾)
- [七、V5：AI 人格系统（情感绑定）](#七v5ai-人格系统情感绑定)
- [八、四层 AI 架构设计](#八四层-ai-架构设计)
- [九、完整数据库演进方案](#九完整数据库演进方案)
- [十、AI Prompt 分层系统](#十ai-prompt-分层系统)
- [十一、完整 API 接口规划](#十一完整-api-接口规划)
- [十二、详细实施计划](#十二详细实施计划)
- [十三、商业化路径](#十三商业化路径)

---

## 一、当前系统现状（已实现）

### 1.1 已完成模块清单

| 模块               | 状态    | 核心能力                                               |
| ------------------ | ------- | ------------------------------------------------------ |
| **认证系统**       | ✅ 完成 | 手机号+验证码、微信扫码、匿名、邮箱密码                |
| **AI 图片分析**    | ✅ 完成 | 上传图片 → AI 识别菜品 → 返回热量估算                  |
| **饮食记录**       | ✅ 完成 | 保存/编辑/删除记录, 今日汇总, 历史分页                 |
| **用户档案**       | ✅ 完成 | 身体数据 + BMR 计算 + 每日热量目标                     |
| **AI 教练**        | ✅ 完成 | SSE 流式对话, 上下文感知, 每日问候                     |
| **食物库**         | ✅ 完成 | 150+ 食物, 模糊搜索, 分类浏览, SEO 落地页              |
| **Web 前端**       | ✅ 完成 | 首页/分析/教练/食物库/个人中心                         |
| **V1 AI 决策系统** | ✅ 完成 | 4级风险评级(SAFE/OK/LIMIT/AVOID) + 替代方案 + 补救策略 |
| **V2 日计划引擎**  | ✅ 完成 | 每日三餐+加餐计划 + 动态调整                           |
| **V3 行为建模**    | ✅ 完成 | 用户画像 + 主动提醒(4场景) + 决策反馈闭环              |
| **V4 游戏化**      | ✅ 完成 | 10成就 + 4挑战 + 连胜系统(失败减半不归零)              |
| **V5 AI 人格**     | ✅ 完成 | 3种教练风格(严格/友善/数据) + 人格化提示词             |

### 1.2 当前技术栈

```
后端: NestJS 11 + TypeORM + PostgreSQL
AI:   OpenRouter → baidu/ernie-4.5-vl-28b-a3b (Vision) + deepseek-chat-v3 (Chat)
前端: Next.js (apps/web) + React (apps/admin)
存储: Cloudflare R2
部署: Railway (API) + Vercel (Web)
```

### 1.3 当前数据库实体

```
app_users              → 用户主表（多端认证）
food_records           → 饮食记录（JSONB foods[] + V1 决策字段 8 列）
daily_summaries        → 每日热量汇总
user_profiles          → 用户健康档案
coach_conversations    → AI教练对话
coach_messages         → 对话消息
foods                  → 食物库（150+ 种子数据）
daily_plans            → V2 每日饮食计划（三餐+加餐+调整记录）
user_behavior_profiles → V3 用户行为画像（偏好/风险时段/教练风格）
ai_decision_logs       → V3 AI决策日志（输入/输出/反馈）
achievements           → V4 成就定义（10条种子数据）
user_achievements      → V4 用户已解锁成就
challenges             → V4 挑战定义（4条种子数据）
user_challenges        → V4 用户参与的挑战
```

### 1.4 当前 AI 分析能力（问题）

```
现状: 图片 → {foods[], totalCalories, advice, isHealthy}
问题:
  ❌ 没有「能不能吃」的判断（用户需要自己看数字判断）
  ❌ 没有「替代方案」（用户知道不能吃但不知道该吃啥）
  ❌ 没有「补救措施」（吃了之后怎么办？）
  ❌ 决策与用户当日饮食状态脱节（不知道今天已经吃了什么）
  ❌ 二元判断（isHealthy: true/false）太粗糙
```

---

## 二、版本演进路线（V1 → V5）

```
V1 首页改版 + AI 决策     ✅ 已完成（2026-04-07）
  ↓
V2 日计划引擎             ✅ 已完成（2026-04-07）
  ↓
V3 行为建模               ✅ 已完成（2026-04-07）
  ↓
V4 游戏化引擎             ✅ 已完成（2026-04-07）
  ↓
V5 AI 人格系统            ✅ 已完成（2026-04-07）
```

| 版本   | 核心升级                       | 用户感知变化               | 商业价值     | 状态      |
| ------ | ------------------------------ | -------------------------- | ------------ | --------- |
| **V1** | 风险评级 + 替代方案 + 补救策略 | "AI告诉我能不能吃、怎么吃" | MVP 核心体验 | ✅ 已上线 |
| **V2** | 每日饮食计划 + 动态调整        | "AI在管理我的一天"         | 日活提升     | ✅ 已上线 |
| **V3** | 用户画像 + 精准干预            | "这个AI懂我"               | 留存壁垒     | ✅ 已上线 |
| **V4** | 连胜系统 + 成就 + 补偿         | "我不想断签"               | 付费转化     | ✅ 已上线 |
| **V5** | 人格选择 + 情感反馈            | "像真人教练"               | 长期付费     | ✅ 已上线 |

---

## 三、V1：AI 饮食决策系统（首页改版）

> 目标：从「识别工具」升级为「决策助手」，用户拍照后立刻知道该怎么做。

### 3.1 首页改版结构

```
┌─────────────────────────────────┐
│  无畏健康              ⚙️       │
├─────────────────────────────────┤
│                                 │
│  ── 🎯 今日状态 ──              │
│  ┌─────────────────────────┐   │
│  │ 剩余 1,260 / 2,000 kcal │   │
│  │ ██████████░░░░  63%     │   │
│  │  已摄入 740   记录 2 餐  │   │
│  └─────────────────────────┘   │
│                                 │
│  ── 📱 核心入口 ──              │
│  ┌──────────┐ ┌──────────┐     │
│  │ 📷       │ │ ✍️       │     │
│  │ 拍照识别  │ │ 手动搜索  │     │
│  └──────────┘ └──────────┘     │
│                                 │
│  ── 🍽️ 今日建议 ──              │
│  ┌─────────────────────────┐   │
│  │ 晚餐推荐:               │   │
│  │ 清蒸鱼+蒜炒青菜+半碗饭   │   │
│  │ ≈ 520 kcal              │   │
│  │ 💡 今天蛋白质偏低        │   │
│  └─────────────────────────┘   │
│                                 │
│  ── 📋 今日记录 ──              │
│  早餐 350 kcal ·燕麦粥...      │
│  午餐 390 kcal · 鸡胸肉沙拉    │
│                                 │
├─────────────────────────────────┤
│ [首页] [分析] [AI教练] [我的]   │
└─────────────────────────────────┘
```

### 3.2 AI 分析返回结构升级

**现有**:

```json
{
  "foods": [{ "name": "宫保鸡丁", "calories": 520, "quantity": "1份约200g", "category": "蛋白质" }],
  "totalCalories": 850,
  "mealType": "lunch",
  "advice": "蔬菜偏少，建议加一份绿叶菜",
  "isHealthy": true
}
```

**升级为**:

```json
{
  "foods": [{ "name": "宫保鸡丁", "calories": 520, "quantity": "1份约200g", "category": "蛋白质" }],
  "totalCalories": 850,
  "mealType": "lunch",
  "decision": "LIMIT",
  "riskLevel": "🟠",
  "reason": "油脂和糖都偏高，容易超标",
  "suggestion": "减少一半分量，优先吃蛋白质",
  "insteadOptions": ["换成烤鸡胸", "去掉酱料", "减少一半分量"],
  "compensation": {
    "diet": "晚餐减少碳水",
    "activity": "增加30分钟步行",
    "nextMeal": "优先蛋白质"
  },
  "contextComment": "你今天脂肪已经偏高",
  "encouragement": "偶尔吃没关系，控制好节奏就行",
  "advice": "蔬菜偏少，建议加一份绿叶菜",
  "isHealthy": false
}
```

### 3.3 四级风险评级（替代二元判断）

| 等级     | 标识          | 含义                | 触发条件                   |
| -------- | ------------- | ------------------- | -------------------------- |
| 🟢 SAFE  | 放心吃        | 纯健康食材/热量充足 | 剩余热量 >50% 且食物清淡   |
| 🟡 OK    | 可以吃但注意  | 整体可控            | 剩余热量 30-50% 或中等热量 |
| 🟠 LIMIT | 少吃/控制份量 | 热量偏高或营养失衡  | 剩余热量 <30% 或高脂高糖   |
| 🔴 AVOID | 建议不吃      | 严重超标            | 已超标或极高热量垃圾食品   |

### 3.4 后端实现方案

#### 3.4.1 新增 Migration

```typescript
// apps/api-server/src/migrations/1746000000000-AddDecisionFields.ts
// 紧接现有 1745 迁移

export class AddDecisionFields1746000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // food_records 新增决策字段
    await queryRunner.query(`
      ALTER TABLE food_records
        ADD COLUMN IF NOT EXISTS decision VARCHAR(10) DEFAULT 'SAFE',
        ADD COLUMN IF NOT EXISTS risk_level VARCHAR(5),
        ADD COLUMN IF NOT EXISTS reason TEXT,
        ADD COLUMN IF NOT EXISTS suggestion TEXT,
        ADD COLUMN IF NOT EXISTS instead_options JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS compensation JSONB,
        ADD COLUMN IF NOT EXISTS context_comment TEXT,
        ADD COLUMN IF NOT EXISTS encouragement TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        DROP COLUMN IF EXISTS decision,
        DROP COLUMN IF EXISTS risk_level,
        DROP COLUMN IF EXISTS reason,
        DROP COLUMN IF EXISTS suggestion,
        DROP COLUMN IF EXISTS instead_options,
        DROP COLUMN IF EXISTS compensation,
        DROP COLUMN IF EXISTS context_comment,
        DROP COLUMN IF EXISTS encouragement;
    `);
  }
}
```

#### 3.4.2 FoodRecord 实体扩展

```typescript
// apps/api-server/src/entities/food-record.entity.ts 新增列

@Column({ type: 'varchar', length: 10, default: 'SAFE' })
decision: string;  // SAFE | OK | LIMIT | AVOID

@Column({ type: 'varchar', length: 5, nullable: true })
riskLevel: string;  // 🟢 🟡 🟠 🔴

@Column({ type: 'text', nullable: true })
reason: string;

@Column({ type: 'text', nullable: true })
suggestion: string;

@Column({ type: 'jsonb', default: '[]' })
insteadOptions: string[];

@Column({ type: 'jsonb', nullable: true })
compensation: { diet?: string; activity?: string; nextMeal?: string };

@Column({ type: 'text', nullable: true })
contextComment: string;

@Column({ type: 'text', nullable: true })
encouragement: string;
```

#### 3.4.3 AnalysisResult 接口升级

```typescript
// apps/api-server/src/app/services/analyze.service.ts

export interface AnalysisResult {
  foods: Array<{
    name: string;
    calories: number;
    quantity?: string;
    category?: string;
  }>;
  totalCalories: number;
  mealType: string;

  // V1 新增：决策字段
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  suggestion: string;
  insteadOptions: string[];
  compensation: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment: string;
  encouragement: string;

  // 保留
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
}
```

#### 3.4.4 Prompt V2（注入用户上下文 + 决策输出）

```typescript
// apps/api-server/src/app/services/analyze.service.ts

const FOOD_ANALYSIS_PROMPT_V2 = (userContext: string) =>
  `你是专业减脂饮食教练，风格：朋友式、简洁、可执行。
你的目标不是提供营养知识，而是帮助用户做"吃或不吃"的决策。

${userContext}

用户上传了一张外卖或餐食图片。请识别图中所有菜品并做出决策判断。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    { "name": "菜名", "calories": 数字, "quantity": "份量描述", "category": "分类" }
  ],
  "totalCalories": 总热量数字,
  "mealType": "breakfast|lunch|dinner|snack",
  "decision": "SAFE|OK|LIMIT|AVOID",
  "riskLevel": "🟢|🟡|🟠|🔴",
  "reason": "一句话原因，不超过20字",
  "suggestion": "具体可执行建议，不超过25字",
  "insteadOptions": ["替代方案1", "替代方案2", "替代方案3"],
  "compensation": {
    "diet": "饮食补救，一句话",
    "activity": "运动补救，一句话",
    "nextMeal": "下一餐建议，一句话"
  },
  "contextComment": "基于今日状态的点评，一句话",
  "encouragement": "积极鼓励语，一句话",
  "advice": "综合营养建议，不超过30字",
  "isHealthy": true或false
}

决策规则：
- SAFE(🟢): 健康食物且剩余热量充足，放心吃
- OK(🟡): 整体可控，注意份量即可
- LIMIT(🟠): 热量偏高或营养失衡，建议减量或替换
- AVOID(🔴): 已超标或极高热量，强烈建议不吃
- 结合用户当日已摄入热量和剩余额度来判断（关键！）
- 如果剩余热量不足该食物总热量的80%，至少判为LIMIT

替代方案规则：
- insteadOptions 必须接近用户原始需求（想吃肉→推荐烤鸡而非沙拉）
- 必须现实可执行（不要"吃水煮菜"，而是"换少油版本"）
- 每条不超过15字

补救规则：
- compensation 给"可恢复路径"，不要惩罚用户
- 如果 decision 是 SAFE，compensation 各字段可为空字符串
- diet/activity/nextMeal 每条不超过15字

其他规则：
- category 只能是 主食/蔬菜/蛋白质/汤类/水果/饮品/零食
- 热量估算保守（宁少不多）
- 无法识别图片时，foods 返回空数组，decision 为 SAFE
- 像朋友一样说话，不要说"建议咨询医生"`;
```

#### 3.4.5 AnalyzeService 改造

```typescript
// apps/api-server/src/app/services/analyze.service.ts 改造要点

// 1. 新增注入
constructor(
  private readonly configService: ConfigService,
  private readonly foodService: FoodService,           // ← 新增
  private readonly userProfileService: UserProfileService, // ← 新增
) { ... }

// 2. 新增方法：构建用户上下文
private async buildUserContext(userId?: string): Promise<string> {
  if (!userId) return '';

  const [summary, profile] = await Promise.all([
    this.foodService.getTodaySummary(userId),
    this.userProfileService.getProfile(userId),
  ]);

  const goal = summary.calorieGoal || 2000;
  const remaining = goal - summary.totalCalories;
  const hour = new Date().getHours();
  const mealHint = hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 18 ? '下午茶' : '晚餐';

  let ctx = `【用户今日饮食状态】
- 每日热量目标：${goal} kcal
- 今日已摄入：${summary.totalCalories} kcal
- 剩余额度：${remaining} kcal
- 已记录餐数：${summary.mealCount} 餐
- 当前时段：${mealHint}`;

  if (profile) {
    ctx += `\n- 用户目标：减脂`;
    if (profile.gender) ctx += `\n- 性别：${profile.gender === 'male' ? '男' : '女'}`;
    if (profile.activityLevel) ctx += `\n- 活动等级：${profile.activityLevel}`;
  }
  return ctx;
}

// 3. analyzeImage 方法新增 userId 参数
async analyzeImage(
  imageUrl: string,
  mealType?: string,
  userId?: string,  // ← 新增
): Promise<{ requestId: string } & AnalysisResult> {
  const userContext = await this.buildUserContext(userId);
  const prompt = FOOD_ANALYSIS_PROMPT_V2(userContext);
  // ... 其余调用逻辑不变，仅替换 prompt ...
}

// 4. parseAnalysisResult 扩展解析
private parseAnalysisResult(content: string): AnalysisResult {
  // ... 现有 JSON 解析 ...
  return {
    // 现有字段
    foods: ..., totalCalories: ..., mealType: ..., advice: ..., isHealthy: ...,
    // V1 新增字段
    decision: ['SAFE','OK','LIMIT','AVOID'].includes(parsed.decision) ? parsed.decision : 'SAFE',
    riskLevel: parsed.riskLevel || '🟢',
    reason: parsed.reason || '',
    suggestion: parsed.suggestion || '',
    insteadOptions: Array.isArray(parsed.insteadOptions) ? parsed.insteadOptions : [],
    compensation: parsed.compensation || {},
    contextComment: parsed.contextComment || '',
    encouragement: parsed.encouragement || '',
  };
}
```

#### 3.4.6 FoodController 改造

```typescript
// apps/api-server/src/app/controllers/food.controller.ts

// analyze 方法传入 user.id
@Post('analyze')
async analyze(@CurrentAppUser() user: any, ...) {
  // ... 上传到 R2 ...
  const result = await this.analyzeService.analyzeImage(imageUrl, mealType, user.id);
  //                                                                         ^^^^^^^^ 新增
  return { success: true, code: 200, message: '分析完成', data: result };
}

// 新增端点：下一餐推荐
@Get('meal-suggestion')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: '获取下一餐推荐' })
async getMealSuggestion(@CurrentAppUser() user: any) {
  const suggestion = await this.foodService.getMealSuggestion(user.id);
  return { success: true, code: 200, message: '操作成功', data: suggestion };
}
```

#### 3.4.7 FoodService 新增下一餐推荐

```typescript
// apps/api-server/src/app/services/food.service.ts 新增

interface MealSuggestion {
  mealType: string;
  remainingCalories: number;
  suggestion: {
    foods: string;
    calories: number;
    tip: string;
  };
}

async getMealSuggestion(userId: string): Promise<MealSuggestion> {
  const summary = await this.getTodaySummary(userId);
  const goal = summary.calorieGoal || 2000;
  const remaining = Math.max(0, goal - summary.totalCalories);
  const hour = new Date().getHours();

  let nextMeal: string;
  if (hour < 9) nextMeal = 'breakfast';
  else if (hour < 14) nextMeal = 'lunch';
  else if (hour < 17) nextMeal = 'snack';
  else nextMeal = 'dinner';

  const suggestion = this.buildMealSuggestion(remaining, nextMeal, summary.mealCount);
  return { mealType: nextMeal, remainingCalories: remaining, suggestion };
}

private buildMealSuggestion(
  remaining: number,
  mealType: string,
  mealsEaten: number,
): { foods: string; calories: number; tip: string } {
  if (remaining <= 0) {
    return { foods: '今日热量已达标', calories: 0, tip: '建议不再进食，喝水或零卡饮品' };
  }

  const budget = this.getMealBudget(mealType, remaining, mealsEaten);
  const presets: Record<string, Array<{ min: number; foods: string; cal: number; tip: string }>> = {
    breakfast: [
      { min: 400, foods: '燕麦粥 + 水煮蛋 + 苹果', cal: 380, tip: '高蛋白早餐帮助减脂' },
      { min: 300, foods: '全麦面包 + 牛奶', cal: 280, tip: '简单营养的早餐搭配' },
      { min: 0, foods: '脱脂牛奶 + 香蕉', cal: 200, tip: '轻食早餐，控制总量' },
    ],
    lunch: [
      { min: 600, foods: '鸡胸肉沙拉 + 糙米饭', cal: 550, tip: '高蛋白低脂午餐' },
      { min: 450, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 420, tip: '清淡搭配，营养均衡' },
      { min: 0, foods: '蔬菜沙拉 + 鸡蛋', cal: 300, tip: '控制午餐，晚餐留余量' },
    ],
    dinner: [
      { min: 600, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 520, tip: '晚餐清淡为主' },
      { min: 400, foods: '水煮虾 + 西兰花', cal: 380, tip: '高蛋白低碳晚餐' },
      { min: 250, foods: '凉拌豆腐 + 拍黄瓜', cal: 220, tip: '额度不多，轻食为好' },
      { min: 0, foods: '一碗清汤 + 蔬菜', cal: 150, tip: '额度紧张，极简晚餐' },
    ],
    snack: [
      { min: 200, foods: '坚果一小把 + 酸奶', cal: 180, tip: '健康加餐，控制份量' },
      { min: 0, foods: '黑咖啡或茶', cal: 5, tip: '零卡饮品不增加负担' },
    ],
  };

  const options = presets[mealType] || presets.dinner;
  const match = options.find(o => budget >= o.min) || options[options.length - 1];
  return { foods: match.foods, calories: match.cal, tip: match.tip };
}

private getMealBudget(mealType: string, remaining: number, mealsEaten: number): number {
  const ratios: Record<string, number> = { breakfast: 0.3, lunch: 0.4, dinner: 0.3, snack: 0.15 };
  return Math.round(remaining * (ratios[mealType] || 0.3));
}
```

#### 3.4.8 DTO 扩展

```typescript
// apps/api-server/src/app/dto/food.dto.ts — SaveFoodRecordDto 新增

@IsOptional()
@IsIn(['SAFE', 'OK', 'LIMIT', 'AVOID'])
decision?: string;

@IsOptional()
@IsString()
riskLevel?: string;

@IsOptional()
@IsString()
reason?: string;

@IsOptional()
@IsString()
suggestion?: string;

@IsOptional()
@IsArray()
insteadOptions?: string[];

@IsOptional()
compensation?: { diet?: string; activity?: string; nextMeal?: string };

@IsOptional()
@IsString()
contextComment?: string;

@IsOptional()
@IsString()
encouragement?: string;
```

#### 3.4.9 AppClientModule 依赖调整

```typescript
// apps/api-server/src/app/app-client.module.ts
// AnalyzeService 现在需要注入 FoodService 和 UserProfileService
// 它们已在同一 Module 的 providers 中，NestJS 自动解析依赖，无需改动 module 配置
// 仅需在 AnalyzeService constructor 中添加 @Inject()
```

### 3.5 前端实现方案

#### 3.5.1 类型扩展

```typescript
// apps/web/src/lib/api/food.ts 新增

export interface AnalysisResult {
  // ... 现有字段 ...
  // V1 新增
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  suggestion: string;
  insteadOptions: string[];
  compensation: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment: string;
  encouragement: string;
}

export interface MealSuggestion {
  mealType: string;
  remainingCalories: number;
  suggestion: {
    foods: string;
    calories: number;
    tip: string;
  };
}
```

#### 3.5.2 新建 DecisionCard 组件

```typescript
// apps/web/src/components/decision-card.tsx

const DECISION_CONFIG = {
  SAFE: {
    emoji: '🟢',
    label: '放心吃',
    bgClass: 'bg-green-50 border-green-200',
    textClass: 'text-green-800',
  },
  OK: {
    emoji: '🟡',
    label: '注意份量',
    bgClass: 'bg-yellow-50 border-yellow-200',
    textClass: 'text-yellow-800',
  },
  LIMIT: {
    emoji: '🟠',
    label: '建议少吃',
    bgClass: 'bg-orange-50 border-orange-200',
    textClass: 'text-orange-800',
  },
  AVOID: {
    emoji: '🔴',
    label: '不建议',
    bgClass: 'bg-red-50 border-red-200',
    textClass: 'text-red-800',
  },
};
```

#### 3.5.3 首页重构要点

1. 去掉 "AI 健康教练 Hero" 大卡片
2. 保留今日状态区（热量进度条 + 已摄入 + 记录数）
3. 核心入口改为两个并排按钮：📷 拍照识别 → /analyze，✍️ 手动搜索 → /foods
4. 新增今日建议区（调用 `GET /api/app/food/meal-suggestion`）
5. 保留今日记录列表
6. 底部导航简化为 4 个（首页/分析/AI教练/我的）

### 3.6 V1 文件变更清单

| 文件                                                           | 操作     | 说明                                                               |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `api-server/src/migrations/1746000000000-AddDecisionFields.ts` | **新建** | 8 个新列                                                           |
| `api-server/src/entities/food-record.entity.ts`                | **修改** | 新增 8 个属性                                                      |
| `api-server/src/app/services/analyze.service.ts`               | **修改** | V2 prompt + buildUserContext + 注入 FoodService/UserProfileService |
| `api-server/src/app/services/food.service.ts`                  | **修改** | 新增 getMealSuggestion + buildMealSuggestion                       |
| `api-server/src/app/controllers/food.controller.ts`            | **修改** | analyze 传 userId + 新增 meal-suggestion 端点                      |
| `api-server/src/app/dto/food.dto.ts`                           | **修改** | SaveFoodRecordDto 新增 8 字段                                      |
| `web/src/lib/api/food.ts`                                      | **修改** | AnalysisResult 扩展 + MealSuggestion 接口                          |
| `web/src/lib/hooks/use-food.ts`                                | **修改** | 新增 getMealSuggestion                                             |
| `web/src/components/decision-card.tsx`                         | **新建** | 四级决策卡片组件                                                   |
| `web/src/pages-component/home/index.tsx`                       | **重构** | 首页全面改版                                                       |
| `web/src/app/[locale]/analyze/page.tsx`                        | **修改** | 结果步骤嵌入 DecisionCard                                          |

---

## 四、V2：日计划引擎（饮食操作系统）

> 目标：从「单次判断」升级为「管理用户一天」。AI 不只在用户问的时候回答，而是主动规划每一餐。

### 4.1 核心能力

```
早上 → AI 自动推荐早餐方案（基于目标和偏好）
中午 → 根据早餐实际摄入，动态调整午餐建议
下午 → 预防暴食提醒
晚上 → 收口策略（基于全天实际数据）
```

### 4.2 新增数据库表

```sql
-- Migration: 1747000000000-AddDailyPlanTable

CREATE TABLE daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- AI 生成的每日策略
  morning_plan JSONB,   -- { foods, calories, tip }
  lunch_plan JSONB,     -- { foods, calories, tip }
  dinner_plan JSONB,    -- { foods, calories, tip }
  snack_plan JSONB,     -- { foods, calories, tip }

  -- 动态调整记录
  adjustments JSONB DEFAULT '[]',  -- [{ time, reason, newPlan }]

  -- 每日策略总结
  strategy TEXT,         -- "今天重点补蛋白，控制碳水"
  total_budget INT,      -- 总热量预算

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_plans_user_date ON daily_plans(user_id, date DESC);
```

### 4.3 新增接口

```
# 获取今日计划（如果没有则 AI 自动生成）
GET /api/app/food/daily-plan
Response: {
  date: "2026-04-07",
  strategy: "今天重点补蛋白，控制碳水",
  totalBudget: 2000,
  morningPlan: { foods: "燕麦 + 鸡蛋 + 牛奶", calories: 400, tip: "高蛋白防午餐暴食" },
  lunchPlan: { foods: "鸡胸肉 + 蔬菜 + 糙米", calories: 600, tip: "正常吃" },
  dinnerPlan: { foods: "清蒸鱼 + 青菜", calories: 450, tip: "控制碳水" },
  snackPlan: { foods: "坚果少量", calories: 150, tip: "下午充饥" },
  adjustments: []
}

# 触发计划动态调整（记录食物后自动调用）
POST /api/app/food/daily-plan/adjust
Body: { reason: "午餐吃了炸鸡超标" }
Response: { updatedPlan, adjustmentNote }
```

### 4.4 实现策略

- **计划生成**：首次调用 daily-plan 时，AI 基于用户档案 + 近 7 天饮食生成（deepseek-chat，非 Vision）
- **动态调整**：每次 saveRecord 后，检查是否偏离计划，偏离则自动调整剩余餐次
- **缓存**：daily_plans 按日存储，同一天内只生成一次，调整追加到 adjustments[]
- **成本控制**：计划生成用规则引擎（V1 的 buildMealSuggestion 扩展），仅调整时调 AI

### 4.5 实施文件清单

| 文件                                            | 操作                |
| ----------------------------------------------- | ------------------- |
| `migrations/1747000000000-AddDailyPlanTable.ts` | 新建                |
| `entities/daily-plan.entity.ts`                 | 新建                |
| `services/daily-plan.service.ts`                | 新建                |
| `controllers/food.controller.ts`                | 新增 2 端点         |
| `app-client.module.ts`                          | 注册新实体和服务    |
| `web/src/lib/api/food.ts`                       | 新增 DailyPlan 接口 |
| `web/src/pages-component/home/index.tsx`        | 展示每日计划卡片    |

---

## 五、V3：行为建模系统（理解用户）

> 目标：从「通用建议」升级为「这个 AI 懂我」。记录用户的行为模式，精准干预。

### 5.1 用户行为画像

```sql
-- Migration: 1748000000000-AddUserBehaviorProfile

CREATE TABLE user_behavior_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,

  -- 饮食偏好（AI 自动分析历史记录填充）
  food_preferences JSONB DEFAULT '{}',
  -- { "loves": ["甜食", "奶茶"], "avoids": ["辣"], "frequentFoods": ["鸡胸肉", "米饭"] }

  -- 行为模式
  binge_risk_hours JSONB DEFAULT '[]',  -- [21, 22, 23] 容易暴食时段
  failure_triggers JSONB DEFAULT '[]',  -- ["夜宵", "聚会", "压力大"]
  avg_compliance_rate DECIMAL(3,2) DEFAULT 0, -- 建议执行率 0~1

  -- AI 风格偏好
  coach_style VARCHAR(20) DEFAULT 'friendly',  -- strict | friendly | data

  -- 统计
  total_records INT DEFAULT 0,
  healthy_records INT DEFAULT 0,
  streak_days INT DEFAULT 0,           -- 连续达标天数
  longest_streak INT DEFAULT 0,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 AI 决策日志（用于反馈闭环 + 优化）

```sql
-- Migration: 同一个文件追加

CREATE TABLE ai_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  record_id UUID REFERENCES food_records(id) ON DELETE SET NULL,

  -- AI 输入
  input_context JSONB,    -- 用户状态快照
  input_image_url TEXT,

  -- AI 输出
  decision VARCHAR(10),
  risk_level VARCHAR(5),
  full_response JSONB,    -- 完整 AI 返回

  -- 用户反馈
  user_followed BOOLEAN,        -- 用户是否听了建议
  user_feedback VARCHAR(20),    -- helpful | unhelpful | wrong
  actual_outcome VARCHAR(20),   -- 当天是否超标

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_logs_user ON ai_decision_logs(user_id, created_at DESC);
```

### 5.3 行为分析服务

```typescript
// services/behavior.service.ts

class BehaviorService {
  // 每周自动分析用户行为（可由 cron 触发）
  async analyzeUserBehavior(userId: string): Promise<void> {
    // 1. 查最近 30 天所有决策日志
    // 2. 计算 compliance_rate（AI 建议 vs 用户行为）
    // 3. 识别暴食时段（哪些小时超标概率最高）
    // 4. 识别失败触发器（哪些食物类别常被标记 AVOID 但仍在吃）
    // 5. 更新 user_behavior_profiles
  }

  // 实时检查：是否处于高风险时段
  async checkBingeRisk(userId: string): Promise<boolean> {
    const hour = new Date().getHours();
    const profile = await this.behaviorRepo.findOne({ userId });
    return profile?.bingeRiskHours?.includes(hour) ?? false;
  }

  // 获取用户偏好上下文（注入 AI prompt）
  async getBehaviorContext(userId: string): Promise<string> {
    const profile = await this.behaviorRepo.findOne({ userId });
    if (!profile) return '';
    return `
【用户行为画像】
- 偏好食物：${profile.foodPreferences?.loves?.join('、') || '未知'}
- 容易暴食时段：${profile.bingeRiskHours?.map((h) => h + ':00').join('、') || '无'}
- 建议执行率：${Math.round((profile.avgComplianceRate || 0) * 100)}%
- 连续达标天数：${profile.streakDays} 天`;
  }
}
```

### 5.4 预判提醒系统

```typescript
// services/proactive-reminder.service.ts

// 定时触发（每 30 分钟检查一次用户状态）
// 或由前端轮询 GET /api/app/food/proactive-check 实现

interface ProactiveReminder {
  type: 'binge_risk' | 'meal_reminder' | 'streak_warning' | 'pattern_alert';
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

async check(userId: string): Promise<ProactiveReminder | null> {
  const hour = new Date().getHours();
  const behavior = await this.getBehaviorProfile(userId);
  const summary = await this.foodService.getTodaySummary(userId);

  // 场景1：高风险暴食时段
  if (behavior.bingeRiskHours.includes(hour)) {
    return {
      type: 'binge_risk',
      message: '你这个时间容易想吃零食，可以提前喝杯水或准备低热量替代',
      urgency: 'high',
    };
  }

  // 场景2：连续多天外卖
  // 场景3：即将断签
  // ...
}
```

### 5.5 实施文件清单

| 文件                                            | 操作                             |
| ----------------------------------------------- | -------------------------------- |
| `migrations/1748000000000-AddBehaviorTables.ts` | 新建                             |
| `entities/user-behavior-profile.entity.ts`      | 新建                             |
| `entities/ai-decision-log.entity.ts`            | 新建                             |
| `services/behavior.service.ts`                  | 新建                             |
| `services/proactive-reminder.service.ts`        | 新建                             |
| `controllers/food.controller.ts`                | 新增 proactive-check 端点        |
| `services/analyze.service.ts`                   | buildUserContext 注入行为画像    |
| `services/food.service.ts`                      | saveRecord 后写 ai_decision_logs |
| `web/src/components/proactive-reminder.tsx`     | 新建前端提醒组件                 |

---

## 六、V4：游戏化引擎（让人上瘾）

> 目标：通过成就系统、连胜机制、社交压力让用户形成习惯。

### 6.1 核心机制

| 机制           | 设计                            | 心理学原理 |
| -------------- | ------------------------------- | ---------- |
| **连胜系统**   | 连续 N 天达标解锁奖励           | 损失厌恶   |
| **失败不归零** | 断签扣一部分进度而非清零        | 防止放弃   |
| **成就徽章**   | 里程碑徽章（7天/30天/体重-5kg） | 成就感     |
| **对比激励**   | "你已经比 70% 的人做得好了"     | 社会比较   |
| **进步感**     | 周报展示进步趋势                | 自我效能   |

### 6.2 数据库设计

```sql
-- Migration: 1749000000000-AddGamificationTables

-- 成就定义表（静态配置）
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,     -- 'streak_7', 'weight_loss_5kg'
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10),                     -- emoji
  category VARCHAR(30),                 -- 'streak' | 'record' | 'milestone'
  threshold INT NOT NULL,               -- 达成条件数值
  reward_type VARCHAR(30),              -- 'badge' | 'unlock_feature' | 'points'
  reward_value INT DEFAULT 0
);

-- 用户成就记录
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id),
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, achievement_id)
);

-- 挑战系统
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(100) NOT NULL,
  description TEXT,
  type VARCHAR(30),                     -- 'no_boba_7d' | 'low_carb_dinner'
  duration_days INT NOT NULL,
  rules JSONB,                          -- 判定规则
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE user_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_progress INT DEFAULT 0,
  max_progress INT NOT NULL,
  status VARCHAR(20) DEFAULT 'active',  -- active | completed | failed
  completed_at TIMESTAMP
);
```

### 6.3 连胜与失败不归零规则

```typescript
// services/gamification.service.ts

// 每次记录后检查连胜
async updateStreak(userId: string): Promise<void> {
  const summary = await this.foodService.getTodaySummary(userId);
  const goal = summary.calorieGoal || 2000;
  const behavior = await this.behaviorRepo.findOne({ userId });

  if (summary.totalCalories <= goal) {
    // 达标：连胜+1
    behavior.streakDays += 1;
    if (behavior.streakDays > behavior.longestStreak) {
      behavior.longestStreak = behavior.streakDays;
    }
    // 检查是否解锁成就
    await this.checkAchievements(userId, behavior.streakDays);
  } else {
    // 超标：不归零，扣一半（最少保留1天）
    behavior.streakDays = Math.max(0, Math.floor(behavior.streakDays * 0.5));
  }

  await this.behaviorRepo.save(behavior);
}
```

### 6.4 实施文件清单

| 文件                                                | 操作             |
| --------------------------------------------------- | ---------------- |
| `migrations/1749000000000-AddGamificationTables.ts` | 新建             |
| `entities/achievement.entity.ts`                    | 新建             |
| `entities/user-achievement.entity.ts`               | 新建             |
| `entities/challenge.entity.ts`                      | 新建             |
| `entities/user-challenge.entity.ts`                 | 新建             |
| `services/gamification.service.ts`                  | 新建             |
| `controllers/gamification.controller.ts`            | 新建             |
| `scripts/seed-achievements.ts`                      | 新建（种子数据） |
| `web/src/app/[locale]/challenge/page.tsx`           | 新建             |
| `web/src/components/achievement-badge.tsx`          | 新建             |

---

## 七、V5：AI 人格系统（情感绑定）

> 目标：让 AI 教练有性格，用户感觉在和「真人」互动。

### 7.1 三种人格模型

| 人格         | 风格           | 示例输出                           | 适合用户       |
| ------------ | -------------- | ---------------------------------- | -------------- |
| **严格教练** | 直接、目标导向 | "不建议吃，这会影响你的目标"       | 自律强的用户   |
| **暖心朋友** | 温和、鼓励为主 | "可以少吃一点～偶尔享受也没关系"   | 容易放弃的用户 |
| **数据理性** | 客观、数据驱动 | "这顿 850 卡，建议控制在 50% 份量" | 理性型用户     |

### 7.2 实现方案

```sql
-- user_behavior_profiles 已有 coach_style 字段
-- coach_style: 'strict' | 'friendly' | 'data'
```

```typescript
// 在 buildSystemPrompt / FOOD_ANALYSIS_PROMPT 中注入人格指令

const PERSONA_PROMPTS = {
  strict: `你的风格是严格教练：直接了当，不拐弯抹角。
    重点强调目标和纪律。语气：坚定但不攻击。
    用语示例："不建议""应该""必须控制"`,

  friendly: `你的风格是暖心朋友：温和鼓励，理解失败很正常。
    避免强烈否定，多给替代方案。语气：像朋友聊天。
    用语示例："可以少吃一点""没关系""慢慢来"`,

  data: `你的风格是数据分析师：客观冷静，用数字说话。
    减少情感表达，强调数据对比。语气：专业理性。
    用语示例："数据显示""建议控制在 X% 以内""根据你的记录"`,
};

// 在 analyze.service.ts 和 coach.service.ts 的 prompt 中追加
const personaPrompt = PERSONA_PROMPTS[userBehaviorProfile.coachStyle || 'friendly'];
```

### 7.3 动态风格切换逻辑

```typescript
// 基于用户行为自动调整（可选）
if (user.avgComplianceRate > 0.8) {
  // 用户自律强 → 可以更严格
  suggestedStyle = 'strict';
} else if (user.avgComplianceRate < 0.3) {
  // 用户总是不听 → 降低严格程度，多鼓励
  suggestedStyle = 'friendly';
}
```

### 7.4 实施文件清单

| 文件                                    | 操作                                        |
| --------------------------------------- | ------------------------------------------- |
| `services/analyze.service.ts`           | 注入人格 prompt                             |
| `services/coach.service.ts`             | buildSystemPrompt 注入人格                  |
| `web/src/app/[locale]/profile/page.tsx` | 新增教练风格选择器                          |
| `dto/food.dto.ts`                       | SaveUserProfileDto 已有 coachStyle 在行为表 |

---

## 八、四层 AI 架构设计

> 长期目标：构建多层 AI 系统，从单一 Prompt 升级为分层架构。

```
用户输入（图片/文字/行为）
        ↓
┌─── 感知层 (Perception) ───┐
│ • 食物识别（Vision Model） │
│ • 场景识别（时间/地点）    │
│ • 情绪推断（暴食/正常）    │
└───────────┬───────────────┘
            ↓
┌─── 用户模型层 (User Model) ───┐
│ • 身体目标（减脂/增肌）        │
│ • 饮食偏好（甜/油/清淡）       │
│ • 行为模式（暴食时段/触发器）   │
│ • 执行力评分（建议采纳率）      │
└───────────┬───────────────────┘
            ↓
┌─── 决策层 (Decision Engine) ───┐
│ • 规则引擎（热量上限/硬约束）   │
│ • AI 推理（灵活建议/替代方案）  │
│ • 混合决策 = 规则 ∩ AI         │
└───────────┬────────────────────┘
            ↓
┌─── 表达层 (Persona Layer) ───┐
│ • 严格教练 / 暖心朋友 / 数据型 │
│ • 语气调整 + 情感表达           │
│ • 鼓励语生成                    │
└───────────┬──────────────────┘
            ↓
        用户看到决策结果
            ↓
┌─── 反馈系统 (Feedback Loop) ───┐
│ • 记录用户是否采纳建议          │
│ • 追踪实际结果（当天是否超标）   │
│ • 更新用户模型 → 优化决策引擎   │
└─────────────────────────────────┘
```

### 实现映射

| AI 层      | 对应代码位置                                            | 当前状态 | 目标版本 |
| ---------- | ------------------------------------------------------- | -------- | -------- |
| 感知层     | `analyze.service.ts` (Vision API)                       | ✅ 有    | V1 增强  |
| 用户模型层 | `user-profile.entity.ts` + 新建 `user-behavior-profile` | 部分     | V3 完善  |
| 决策层     | `FOOD_ANALYSIS_PROMPT` + `buildMealSuggestion()`        | ❌ 无    | V1 新建  |
| 表达层     | `PERSONA_PROMPTS`                                       | ❌ 无    | V5 新建  |
| 反馈系统   | `ai_decision_logs`                                      | ❌ 无    | V3 新建  |

---

## 九、完整数据库演进方案

### Migration 链

```
已有（✅ 生产环境已执行）:
  1742000000000 - AddFoodAndProfileTables    ← food_records, daily_summaries, user_profiles
  1743000000000 - AddCoachTables             ← coach_conversations, coach_messages
  1744000000000 - AddFoodLibraryTable        ← foods (食物库)
  1745000000000 - AddWechatMiniOpenId        ← app_users 微信小程序字段

V1-V5（✅ 2026-04-07 生产环境已执行）:
  V1: 1746000000000 - AddDecisionFields           ← food_records 新增 8 列决策字段
  V2: 1747000000000 - AddDailyPlanTable            ← daily_plans
  V3: 1748000000000 - AddBehaviorTables            ← user_behavior_profiles, ai_decision_logs
  V4: 1749000000000 - AddGamificationTables        ← achievements(10条) + user_achievements + challenges(4条) + user_challenges
```

### 最终 ER 图

```
app_users (1)
  ├── (N) food_records
  │         └── foods: FoodItem[] (JSONB)
  │         └── decision, compensation... (V1)
  ├── (N) daily_summaries
  ├── (1) user_profiles
  ├── (1) user_behavior_profiles (V3)
  ├── (N) ai_decision_logs (V3)
  ├── (N) daily_plans (V2)
  ├── (N) coach_conversations
  │         └── (N) coach_messages
  ├── (N) user_achievements (V4)
  └── (N) user_challenges (V4)

foods (独立，静态 150+ 种子数据)
achievements (独立，静态配置)
challenges (独立，可动态添加)
```

---

## 十、AI Prompt 分层系统

### 10.1 Prompt 文件组织

```
apps/api-server/src/prompts/
  ├── food-analysis-v2.ts       ← V1: 图片分析 + 决策
  ├── daily-plan.ts             ← V2: 每日计划生成
  ├── coach-system.ts           ← 现有教练 system prompt（迁移至此）
  ├── behavior-analysis.ts      ← V3: 用户行为分析（周批处理）
  └── personas/
      ├── strict.ts             ← V5: 严格教练
      ├── friendly.ts           ← V5: 暖心朋友
      └── data.ts               ← V5: 数据理性
```

### 10.2 Prompt 构成层

每次 AI 调用的 Prompt 由以下层组成：

```
最终 Prompt = 基础指令 + 用户档案上下文 + 行为画像上下文 + 人格指令 + 任务指令
```

```typescript
function buildFullPrompt(
  taskPrompt: string, // 具体任务（分析/计划/建议）
  userContext: string, // 来自 UserProfile + DailySummary
  behaviorContext: string, // 来自 UserBehaviorProfile（V3）
  personaPrompt: string // 来自 PERSONA_PROMPTS（V5）
): string {
  return `${personaPrompt}\n\n${userContext}\n\n${behaviorContext}\n\n${taskPrompt}`;
}
```

### 10.3 各版本 Prompt 升级路径

| 版本 | Prompt 变化                                                         |
| ---- | ------------------------------------------------------------------- |
| V1   | 新增 `userContext`（今日摄入/剩余），输出新增 decision/compensation |
| V2   | 新增 `dailyPlanPrompt`（生成每日计划）                              |
| V3   | 新增 `behaviorContext`（偏好/暴食时段/执行率）                      |
| V5   | 新增 `personaPrompt`（三种人格可切换）                              |

---

## 十一、完整 API 接口规划

### 11.1 V1 新增/改动接口

```
# [改动] AI 分析 — 返回结构增加决策字段
POST /api/app/food/analyze
Response 新增: decision, riskLevel, reason, suggestion, insteadOptions,
               compensation, contextComment, encouragement

# [改动] 保存记录 — DTO 新增决策字段
POST /api/app/food/records
Body 新增: decision?, riskLevel?, reason?, suggestion?, insteadOptions?,
           compensation?, contextComment?, encouragement?

# [新增] 下一餐推荐
GET /api/app/food/meal-suggestion
Response: { mealType, remainingCalories, suggestion: { foods, calories, tip } }
```

### 11.2 V2 新增接口

```
# 获取/生成今日计划
GET /api/app/food/daily-plan
Response: { date, strategy, totalBudget, morningPlan, lunchPlan, dinnerPlan, snackPlan, adjustments }

# 触发计划调整
POST /api/app/food/daily-plan/adjust
Body: { reason }
Response: { updatedPlan, adjustmentNote }
```

### 11.3 V3 新增接口

```
# 获取行为画像
GET /api/app/food/behavior-profile
Response: { foodPreferences, bingeRiskHours, avgComplianceRate, streakDays, coachStyle }

# 主动提醒检查
GET /api/app/food/proactive-check
Response: { reminder: { type, message, urgency } | null }

# AI 决策反馈
POST /api/app/food/decision-feedback
Body: { recordId, followed: boolean, feedback: 'helpful'|'unhelpful'|'wrong' }
```

### 11.4 V4 新增接口

```
# 成就列表
GET /api/app/achievements
Response: { all: Achievement[], unlocked: UserAchievement[] }

# 挑战列表
GET /api/app/challenges
Response: { available: Challenge[], active: UserChallenge[] }

# 参加挑战
POST /api/app/challenges/:id/join
Response: { userChallenge }

# 连胜状态
GET /api/app/streak
Response: { current: 7, longest: 14, todayStatus: 'on_track' | 'at_risk' | 'exceeded' }
```

### 11.5 V5 新增接口

```
# 切换教练风格
PUT /api/app/coach/style
Body: { style: 'strict' | 'friendly' | 'data' }
```

### 11.6 现有不变接口

```
# 饮食记录
GET  /api/app/food/records/today
GET  /api/app/food/records?page=&limit=&date=
PUT  /api/app/food/records/:id
DELETE /api/app/food/records/:id
GET  /api/app/food/summary/today
GET  /api/app/food/summary/recent?days=

# 食物库（公开）
GET  /api/foods/search?q=&limit=
GET  /api/foods/popular?category=&limit=
GET  /api/foods/categories
GET  /api/foods/by-name/:name
GET  /api/foods/:id

# AI 教练
POST /api/app/coach/chat (SSE)
GET  /api/app/coach/conversations
GET  /api/app/coach/conversations/:id/messages
DELETE /api/app/coach/conversations/:id
GET  /api/app/coach/daily-greeting

# 用户档案
GET  /api/app/food/profile
PUT  /api/app/food/profile

# 认证
POST /api/app/auth/phone/send-code
POST /api/app/auth/phone/verify
POST /api/app/auth/wechat/auth-url
POST /api/app/auth/wechat/login
POST /api/app/auth/anonymous
POST /api/app/auth/email/register
POST /api/app/auth/email/login
GET  /api/app/auth/profile
PUT  /api/app/auth/profile
```

---

## 十二、实施完成记录

> **全部 V1-V5 已于 2026-04-07 完成开发并部署到生产环境。**

### Phase V1：AI 决策 + 首页改版 ✅

#### 后端变更

```
[x] 新建 Migration 1746000000000-AddDecisionFields → food_records 新增 8 列
[x] 修改 food-record.entity.ts → 新增 decision/riskLevel/reason/suggestion 等字段
[x] 修改 food.dto.ts → SaveFoodRecordDto 新增 8 个可选字段
[x] 修改 analyze.service.ts → V2 prompt + buildUserContext + 4 级风险评级
[x] 修改 food.service.ts → getMealSuggestion + buildMealSuggestion + getMealBudget
[x] 修改 food.controller.ts → analyze 传入 userId + GET meal-suggestion 端点
```

#### 前端变更

```
[x] 新建 web/src/components/decision-card.tsx → 四级决策卡片
[x] 修改 web/src/app/[locale]/analyze/page.tsx → 嵌入 DecisionCard
[x] 重构 web/src/pages-component/home/index.tsx → 双入口 + 每日建议 + 决策徽章
[x] 扩展 web/src/lib/api/food.ts → AnalysisResult 接口扩展
[x] 扩展 web/src/lib/hooks/use-food.ts → getMealSuggestion
```

---

### Phase V2：日计划引擎 ✅

#### 后端变更

```
[x] 新建 Migration 1747000000000-AddDailyPlanTable
[x] 新建 entities/daily-plan.entity.ts → MealPlan + PlanAdjustment 接口
[x] 新建 services/daily-plan.service.ts → getPlan(惰性) + generatePlan(规则) + adjustPlan(动态)
[x] 修改 food.controller.ts → GET daily-plan + POST daily-plan/adjust
[x] 修改 app-client.module.ts → 注册 DailyPlan + DailyPlanService
```

#### 前端变更

```
[x] 扩展 food.ts → DailyPlanData/MealPlan 类型 + getDailyPlan/adjustDailyPlan API
[x] 首页展示每日计划卡片（morningPlan/lunchPlan/dinnerPlan/snackPlan）
```

---

### Phase V3：行为建模 ✅

#### 后端变更

```
[x] 新建 Migration 1748000000000-AddBehaviorTables → user_behavior_profiles + ai_decision_logs
[x] 新建 entities/user-behavior-profile.entity.ts
[x] 新建 entities/ai-decision-log.entity.ts
[x] 新建 services/behavior.service.ts → getProfile + proactiveCheck(4场景) + getBehaviorContext
[x] 修改 food.controller.ts → GET behavior-profile + GET proactive-check + POST decision-feedback
[x] 修改 analyze.service.ts → 注入 BehaviorService，行为上下文融入 AI 分析
```

#### 前端变更

```
[x] 新建 web/src/components/proactive-reminder.tsx → 紧急度分级提醒
[x] 扩展 food.ts → BehaviorProfile/ProactiveReminder 类型 + API 方法
[x] 首页展示主动提醒区域
```

---

### Phase V4：游戏化 ✅

#### 后端变更

```
[x] 新建 Migration 1749000000000-AddGamificationTables → 4 表 + 种子数据(10成就+4挑战)
[x] 新建 entities/achievement.entity.ts + user-achievement.entity.ts
[x] 新建 entities/challenge.entity.ts + user-challenge.entity.ts
[x] 新建 services/gamification.service.ts → 连胜(失败减半不归零) + 成就检测 + 挑战
[x] 新建 controllers/gamification.controller.ts → GET achievements/challenges/streak + POST join
```

#### 前端变更

```
[x] 新建 web/src/components/achievement-badge.tsx → 成就徽章
[x] 新建 web/src/app/[locale]/challenge/page.tsx → 挑战页(连胜+成就+挑战列表)
[x] 扩展 food.ts → Achievement/Challenge/StreakStatus 类型 + API 方法
```

---

### Phase V5：AI 人格 ✅

#### 后端变更

```
[x] 修改 analyze.service.ts → 注入 PERSONA_PROMPTS(strict/friendly/data) + 人格上下文
[x] 修改 coach.service.ts → buildSystemPrompt 注入行为上下文 + 人格
[x] 修改 coach.controller.ts → PUT /api/app/coach/style 接口
```

#### 前端变更

```
[x] 修改 web/src/app/[locale]/profile/page.tsx → 教练风格选择器(3按钮) + 行为统计卡片
[x] 扩展 food.ts → updateCoachStyle + getBehaviorProfile API
```

---

### 部署验证记录（2026-04-07）

| 接口        | 方法 | 路径                              | 状态   |
| ----------- | ---- | --------------------------------- | ------ |
| V1 餐食建议 | GET  | `/api/app/food/meal-suggestion`   | ✅ 200 |
| V2 每日计划 | GET  | `/api/app/food/daily-plan`        | ✅ 200 |
| V2 计划调整 | POST | `/api/app/food/daily-plan/adjust` | ✅ 200 |
| V3 行为画像 | GET  | `/api/app/food/behavior-profile`  | ✅ 200 |
| V3 主动提醒 | GET  | `/api/app/food/proactive-check`   | ✅ 200 |
| V3 决策反馈 | POST | `/api/app/food/decision-feedback` | ✅ 200 |
| V4 成就列表 | GET  | `/api/app/achievements`           | ✅ 200 |
| V4 挑战列表 | GET  | `/api/app/challenges`             | ✅ 200 |
| V4 加入挑战 | POST | `/api/app/challenges/:id/join`    | ✅ 200 |
| V4 连胜状态 | GET  | `/api/app/streak`                 | ✅ 200 |
| V5 切换风格 | PUT  | `/api/app/coach/style`            | ✅ 200 |

### 数据库迁移链

```
1742000000000-CreateFoodTables        ✅ (基础)
1743000000000-AddCoachTables          ✅ (教练)
1744000000000-AddFoodLibraryTable     ✅ (食物库)
1745000000000-AddWechatMiniOpenId     ✅ (微信小程序)
1746000000000-AddDecisionFields       ✅ V1 (决策字段)
1747000000000-AddDailyPlanTable       ✅ V2 (日计划)
1748000000000-AddBehaviorTables       ✅ V3 (行为建模)
1749000000000-AddGamificationTables   ✅ V4 (游戏化)
```

### 文件变更汇总

| 类别         | 新增文件    | 修改文件    |
| ------------ | ----------- | ----------- |
| **迁移**     | 4           | 0           |
| **实体**     | 7           | 1           |
| **服务**     | 3           | 3           |
| **控制器**   | 1           | 2           |
| **DTO**      | 0           | 2           |
| **模块**     | 0           | 2           |
| **前端组件** | 3           | 0           |
| **前端页面** | 1           | 3           |
| **前端API**  | 0           | 2           |
| **合计**     | **19 新增** | **15 修改** |

---

## 十三、商业化路径

### 13.1 免费 vs 付费

| 功能         | 免费    | Pro (¥19-39/月) |
| ------------ | ------- | --------------- |
| AI 分析      | 3 次/天 | 无限            |
| 饮食记录     | ✅      | ✅              |
| 今日建议     | ✅      | ✅              |
| AI 教练      | 5 条/天 | 无限            |
| 每日计划     | ❌      | ✅ (V2)         |
| 行为分析     | ❌      | ✅ (V3)         |
| 教练风格选择 | ❌      | ✅ (V5)         |
| 挑战模式     | 基础    | 高级 (V4)       |

### 13.2 增长飞轮

```
分析结果分享（一键生成图片）
    → 小红书/朋友圈曝光
    → 新用户进入（好奇 AI 分析效果）
    → 免费试用 3 次
    → 觉得有用 → 付费
    → 更多使用 → 更多数据 → 更精准
```

### 13.3 内容营销策略

```
类型1（爆款）："这份外卖 = 跑步2小时？" → 对比类
类型2（打脸）："你以为健康，其实最胖的食物" → 认知类
类型3（挑战）："我用AI减肥7天，结果…" → 故事类

转化路径：内容 → 评论区 → H5/小程序 → 注册使用
```

---

## 附录：核心设计原则

### A. 产品原则

1. **不展示复杂数据**：用户要的是「能不能吃」，不是卡路里表
2. **建议必须可执行**：用户看完就知道该干嘛
3. **不惩罚用户**：吃错后给补救路径，不给负罪感
4. **替代方案接近原需求**：想吃肉 → 推荐烤鸡，不推荐沙拉

### B. 技术原则

1. **规则 + AI 混合**：AI 负责理解和生成，规则负责稳定性
2. **成本控制**：meal-suggestion 用规则引擎（零成本），daily-plan 用缓存（每天一次 AI）
3. **渐进式增强**：每个版本独立可用，不依赖后续版本
4. **反馈驱动**：记录 AI 决策日志，持续优化 prompt

### C. 容错设计

1. **图片模糊**：AI 按高热量保守处理
2. **用户乱输入**：引导补充信息，不报错
3. **用户不听建议**：降低严格度 + 增加鼓励（不是放弃）
4. **AI 返回异常**：所有新字段都有安全默认值（decision=SAFE, insteadOptions=[]）
