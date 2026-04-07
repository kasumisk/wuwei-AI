# 无畏健康 — 首页改版 & AI 决策模式整合方案

> 版本：v1.0 | 日期：2026-04-07
>
> 核心目标：**将首页从「数据展示面板」转变为「饮食决策助手」**
>
> 产品理念：**AI 帮你"决定吃什么"的减肥助手，不是卡路里计算器。**

---

## 一、改版总览

### 1.1 核心变化点

| 维度 | 现状 | 改版后 |
|------|------|--------|
| **首页定位** | 数据仪表盘（剩余卡路里 + 今日记录列表） | 饮食决策中心（能不能吃 + 建议 + 补救） |
| **AI 分析返回** | `{foods, totalCalories, advice, isHealthy}` | 新增 `decision / reason / suggestion / compensation` |
| **用户核心行为** | 上传图片 → 看热量 → 手动判断 | 上传图片 → AI 告诉你能不能吃 + 怎么吃 |
| **今日建议** | 无（仅在 AI 教练页有 greeting） | 首页底部实时显示「剩余热量 + 晚餐推荐」 |
| **中间入口** | 仅"拍照或上传截图" | 📷 拍照识别 + ✍️ 手动输入搜索 |

### 1.2 改版后首页结构

```
┌─────────────────────────────────┐
│  无畏健康              ⚙️       │  ← 顶部导航栏
├─────────────────────────────────┤
│                                 │
│  ── 今日状态 ──                 │
│  ┌─────────────────────────┐   │
│  │ 剩余 1,260 / 2,000 kcal │   │  ← 热量进度条
│  │ ████████░░░░  63%       │   │
│  │                         │   │
│  │  已摄入 740   目标 2000  │   │  ← 已摄入 + 目标
│  │  记录 2 餐    蛋白质 30g │   │  ← 餐数 + 蛋白质（可选）
│  └─────────────────────────┘   │
│                                 │
│  ── 核心入口 ──                 │
│  ┌──────────┐ ┌──────────┐     │
│  │ 📷       │ │ ✍️       │     │
│  │ 拍照识别  │ │ 手动输入  │     │  ← 两个并排入口
│  └──────────┘ └──────────┘     │
│                                 │
│  ── AI 结果卡片 ──              │  ← 分析后出现
│  ┌─────────────────────────┐   │
│  │ 🟡 LIMITED              │   │
│  │ 油脂和糖都偏高，容易超标  │   │  ← reason
│  │                         │   │
│  │ 💡 减少一半分量，优先     │   │
│  │    吃蛋白质             │   │  ← suggestion
│  │                         │   │
│  │ 🏃 今天多走30分钟或      │   │
│  │    减少晚餐碳水         │   │  ← compensation
│  │                         │   │
│  │ [确认记录] [重新分析]    │   │
│  └─────────────────────────┘   │
│                                 │
│  ── 今日建议 ──                 │
│  ┌─────────────────────────┐   │
│  │ 今日剩余 1,260 kcal     │   │
│  │                         │   │
│  │ 🍽️ 晚餐推荐:            │   │
│  │ 清蒸鱼 + 蒜炒青菜       │   │
│  │ + 半碗米饭 ≈ 520 kcal   │   │
│  │                         │   │
│  │ 💡 今天蛋白质偏低,       │   │
│  │    晚餐多吃高蛋白食物    │   │
│  └─────────────────────────┘   │
│                                 │
│  ── 今日记录 ──                 │
│  早餐 350kcal 燕麦粥...        │
│  午餐 390kcal 鸡胸肉沙拉...    │
│                                 │
└─────────────────────────────────┤
│ [首页] [分析] [AI教练] [我的]   │  ← 底部导航（去掉挑战，简化）
└─────────────────────────────────┘
```

---

## 二、后端改动方案

### 2.1 AI 分析提示词改造（analyze.service.ts）

#### 现有 Prompt（仅做营养数据识别）

```
"识别菜品 → 返回 {foods, totalCalories, advice, isHealthy}"
```

#### 新 Prompt（增加决策维度）

需要在 AI 分析时注入用户的今日饮食上下文，使 AI 给出「能不能吃」的判断。

```typescript
// apps/api-server/src/app/services/analyze.service.ts

// ═══ 新增：需要注入 FoodService + UserProfileService ═══

const FOOD_ANALYSIS_PROMPT_V2 = (userContext: string) => `你是专业减脂饮食教练。

你的目标不是提供营养知识，而是帮助用户做"吃或不吃"的决策。

${userContext}

用户上传了一张外卖或餐食图片。请识别图中所有菜品并做出决策判断。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    {
      "name": "宫保鸡丁",
      "calories": 520,
      "quantity": "1份约200g",
      "category": "蛋白质"
    }
  ],
  "totalCalories": 850,
  "mealType": "lunch",
  "decision": "LIMITED",
  "reason": "油脂和糖都偏高，容易超标",
  "suggestion": "减少一半分量，优先吃蛋白质",
  "compensation": "今天多走30分钟或减少晚餐碳水",
  "advice": "蔬菜偏少，建议加一份绿叶菜",
  "isHealthy": false
}

规则：
- decision 只能是 YES / NO / LIMITED（YES=放心吃, LIMITED=控制份量, NO=建议不吃）
- reason 一句话说明原因，不超过 20 字，用口语
- suggestion 给出具体可执行的建议，不超过 25 字
- compensation 如果吃了的补救措施，不超过 30 字（decision=YES 时可为空字符串）
- advice 必须具体且不超过 30 字
- 无法识别的菜品根据外卖常见份量估算
- 热量估算保守一些（宁少不多）
- mealType 只能是 breakfast / lunch / dinner / snack
- category 只能是 主食 / 蔬菜 / 蛋白质 / 汤类 / 水果 / 饮品 / 零食
- 无法识别图片时，foods 返回空数组，decision 为 "YES"，reason 说明无法识别
- 不要长篇解释，像朋友一样简洁
- 决策依据：结合用户当前已摄入热量和剩余额度来判断`;
```

#### 用户上下文注入逻辑

```typescript
// analyze.service.ts 新增方法

/**
 * 构建 AI 分析时的用户饮食上下文
 * 让 AI 知道用户今天已经吃了什么，才能做出「能不能吃」的判断
 */
private async buildUserContext(userId: string): Promise<string> {
  const [summary, profile] = await Promise.all([
    this.foodService.getTodaySummary(userId),
    this.userProfileService.getProfile(userId),
  ]);

  const goal = summary.calorieGoal || 2000;
  const remaining = goal - summary.totalCalories;

  const hour = new Date().getHours();
  const mealHint = hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 18 ? '下午茶/加餐' : '晚餐';

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
```

### 2.2 AnalysisResult 接口扩展

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

  // ═══ 新增字段 ═══
  decision: 'YES' | 'NO' | 'LIMITED';  // 能不能吃
  reason: string;                       // 原因（一句话）
  suggestion: string;                   // 建议（替代方案）
  compensation: string;                 // 补救措施

  // ═══ 保留字段 ═══
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
}
```

### 2.3 analyzeImage 方法改造

```typescript
// analyze.service.ts — analyzeImage 改造要点

async analyzeImage(
  imageUrl: string,
  mealType?: string,
  userId?: string,   // ← 新增：传入 userId 以获取用户上下文
): Promise<{ requestId: string } & AnalysisResult> {

  // 1. 构建用户饮食上下文（如有 userId）
  let userContext = '';
  if (userId) {
    userContext = await this.buildUserContext(userId);
  }

  // 2. 使用 V2 prompt（含用户上下文）
  const prompt = FOOD_ANALYSIS_PROMPT_V2(userContext);

  // 3. 调用 AI ... (其余逻辑不变)
}
```

### 2.4 parseAnalysisResult 扩展

```typescript
// 在 parseAnalysisResult 中新增字段解析

private parseAnalysisResult(content: string): AnalysisResult {
  // ... 现有 JSON 解析逻辑不变 ...

  return {
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    totalCalories: typeof parsed.totalCalories === 'number' ? parsed.totalCalories : 0,
    mealType: parsed.mealType || 'lunch',

    // ═══ 新增 ═══
    decision: ['YES', 'NO', 'LIMITED'].includes(parsed.decision) ? parsed.decision : 'YES',
    reason: parsed.reason || '',
    suggestion: parsed.suggestion || '',
    compensation: parsed.compensation || '',

    // ═══ 保留 ═══
    advice: parsed.advice || '',
    isHealthy: typeof parsed.isHealthy === 'boolean' ? parsed.isHealthy : true,
  };
}
```

### 2.5 food_records 表兼容（无需 Migration）

新增的 `decision / reason / suggestion / compensation` 字段不需要单独的数据库列。原因：

1. `foods` 是 JSONB 列，已存储 `advice` / `isHealthy`，可直接扩展
2. 更好的方案：在 `FoodRecord` 实体中新增 4 个列（可选），或者把它们存入已有的 `advice` 字段的 JSON 扩展

**推荐方案 A：新增数据库列（需要 Migration）**

```sql
-- Migration: AddDecisionFields
ALTER TABLE food_records
  ADD COLUMN IF NOT EXISTS decision VARCHAR(10) DEFAULT 'YES',
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS suggestion TEXT,
  ADD COLUMN IF NOT EXISTS compensation TEXT;
```

**方案 B：不加列，仅存到 advice JSON（不推荐，查询不便）**

→ 推荐方案 A，保持结构清晰。

### 2.6 FoodRecord 实体扩展

```typescript
// apps/api-server/src/entities/food-record.entity.ts

// ═══ 新增列 ═══
@Column({ type: 'varchar', length: 10, default: 'YES' })
decision: string; // YES / NO / LIMITED

@Column({ type: 'text', nullable: true })
reason: string;

@Column({ type: 'text', nullable: true })
suggestion: string;

@Column({ type: 'text', nullable: true })
compensation: string;
```

### 2.7 SaveFoodRecordDto 扩展

```typescript
// apps/api-server/src/app/dto/food.dto.ts

// ═══ 新增字段 ═══
@IsOptional()
@IsIn(['YES', 'NO', 'LIMITED'])
decision?: string;

@IsOptional()
@IsString()
reason?: string;

@IsOptional()
@IsString()
suggestion?: string;

@IsOptional()
@IsString()
compensation?: string;
```

### 2.8 FoodController.analyze 方法改造

```typescript
// apps/api-server/src/app/controllers/food.controller.ts

@Post('analyze')
async analyze(
  @CurrentAppUser() user: any,     // ← 已有 JWT guard 注入 user
  @UploadedFile() file: Express.Multer.File,
  @Body('mealType') mealType?: string,
) {
  // 传入 user.id 让 AI 获取用户上下文
  const result = await this.analyzeService.analyzeImage(imageUrl, mealType, user.id);
  // ...
}
```

---

## 三、「今日建议」功能实现方案

### 3.1 需求分析

首页底部需要实时显示：
- **今日剩余热量**（已有 `GET /api/app/food/summary/today`）
- **晚餐推荐**（新功能：根据已摄入 + 剩余额度推荐具体菜品搭配）

### 3.2 方案选择

| 方案 | 描述 | 优缺点 |
|------|------|--------|
| **A: AI 实时生成** | 每次首页加载调用 AI 生成推荐 | ❌ 成本高、慢 |
| **B: 规则引擎 + 食物库** | 根据剩余热量 + 食物库 匹配推荐 | ✅ 零成本、快 |
| **C: AI 生成 + 缓存** | AI 生成后缓存 2 小时 | ✅ 平衡体验和成本 |
| **D: 复用 Coach 接口** | 调用现有 daily-greeting 扩展 | ✅ 最快实现 |

**推荐方案：B + D 结合**

- 「今日剩余热量」→ 直接用现有 `GET /api/app/food/summary/today`
- 「晚餐推荐」→ 新增 `GET /api/app/food/meal-suggestion` 接口，使用规则引擎 + 食物库实现，不走 AI

### 3.3 新增接口：`GET /api/app/food/meal-suggestion`

```typescript
// apps/api-server/src/app/controllers/food.controller.ts — 新增端点

@Get('meal-suggestion')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: '获取下一餐推荐（基于剩余热量）' })
async getMealSuggestion(
  @CurrentAppUser() user: any,
): Promise<ApiResponse> {
  const suggestion = await this.foodService.getMealSuggestion(user.id);
  return { success: true, code: 200, message: '操作成功', data: suggestion };
}
```

### 3.4 MealSuggestion 服务逻辑

```typescript
// apps/api-server/src/app/services/food.service.ts — 新增方法

interface MealSuggestion {
  mealType: string;          // 推荐的餐次（breakfast/lunch/dinner/snack）
  remainingCalories: number; // 剩余可用热量
  suggestion: {
    foods: string;           // 推荐菜品组合（文案）
    calories: number;        // 推荐热量
    tip: string;             // 一句话提示
  };
}

async getMealSuggestion(userId: string): Promise<MealSuggestion> {
  const summary = await this.getTodaySummary(userId);
  const goal = summary.calorieGoal || 2000;
  const remaining = Math.max(0, goal - summary.totalCalories);

  const hour = new Date().getHours();

  // 判断下一餐是什么
  let nextMeal: string;
  if (hour < 9) nextMeal = 'breakfast';
  else if (hour < 11) nextMeal = 'lunch';
  else if (hour < 16) nextMeal = hour < 14 ? 'lunch' : 'snack';
  else nextMeal = 'dinner';

  // 根据剩余热量推荐
  const suggestion = this.buildMealSuggestion(remaining, nextMeal, summary.mealCount);

  return {
    mealType: nextMeal,
    remainingCalories: remaining,
    suggestion,
  };
}

private buildMealSuggestion(
  remaining: number,
  mealType: string,
  mealsEaten: number,
): { foods: string; calories: number; tip: string } {
  // ═══ 规则引擎：根据剩余热量 + 餐次推荐 ═══

  if (remaining <= 0) {
    return {
      foods: '今日热量已达标',
      calories: 0,
      tip: '建议不再进食，或选择零卡饮品',
    };
  }

  // 分配逻辑：按餐次剩余比例分配
  const mealBudget = Math.min(remaining, this.getMealBudget(mealType, remaining, mealsEaten));

  // 按预算匹配推荐
  if (mealType === 'breakfast') {
    if (mealBudget >= 400) return { foods: '燕麦粥 + 水煮蛋 + 苹果', calories: 380, tip: '高蛋白早餐帮助减脂' };
    if (mealBudget >= 300) return { foods: '全麦面包 + 牛奶', calories: 280, tip: '简单营养的早餐搭配' };
    return { foods: '一杯脱脂牛奶 + 香蕉', calories: 200, tip: '轻食早餐，控制总量' };
  }

  if (mealType === 'lunch') {
    if (mealBudget >= 600) return { foods: '鸡胸肉沙拉 + 糙米饭', calories: 550, tip: '高蛋白低脂午餐' };
    if (mealBudget >= 450) return { foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', calories: 420, tip: '清淡搭配，营养均衡' };
    return { foods: '蔬菜沙拉 + 鸡蛋', calories: 300, tip: '控制午餐热量，晚餐留余量' };
  }

  if (mealType === 'dinner') {
    if (mealBudget >= 600) return { foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', calories: 520, tip: '晚餐清淡为主' };
    if (mealBudget >= 400) return { foods: '水煮虾 + 西兰花 + 少量主食', calories: 380, tip: '高蛋白低碳晚餐' };
    if (mealBudget >= 250) return { foods: '凉拌豆腐 + 拍黄瓜', calories: 220, tip: '今日额度不多，轻食为好' };
    return { foods: '一碗清汤 + 蔬菜', calories: 150, tip: '额度紧张，建议极简晚餐' };
  }

  // snack
  if (mealBudget >= 200) return { foods: '坚果一小把 + 酸奶', calories: 180, tip: '健康加餐，控制份量' };
  return { foods: '一杯黑咖啡或茶', calories: 5, tip: '零卡饮品不增加负担' };
}

private getMealBudget(mealType: string, remaining: number, mealsEaten: number): number {
  // 分配比例：早30% 午40% 晚30%（已吃过的餐不计入）
  const ratios: Record<string, number> = {
    breakfast: 0.3,
    lunch: 0.4,
    dinner: 0.3,
    snack: 0.15,
  };
  return Math.round(remaining * (ratios[mealType] || 0.3));
}
```

> **后期优化**：当食物库（`foods` 表）数据充足后，从食物库中随机匹配组合，替代硬编码推荐。

### 3.5 「今日状态」数据来源

今日状态卡片需要的全部数据已由现有接口提供：

```
GET /api/app/food/summary/today
→ { totalCalories, calorieGoal, mealCount, remaining }
```

蛋白质等宏量营养素数据当前未单独追踪。

**方案**：MVP 阶段不展示蛋白质（文档中 PRODUCTION2.md 也明确说 "不要展示宏量营养细节"），只展示：
- 剩余卡路里
- 已摄入
- 目标
- 记录餐数

---

## 四、前端改动方案

### 4.1 首页组件重构（apps/web/src/pages-component/home/index.tsx）

#### 状态管理扩展

```typescript
// 新增状态
const [mealSuggestion, setMealSuggestion] = useState<MealSuggestion | null>(null);
const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);

// 新增 API 调用
useEffect(() => {
  if (!isLoggedIn) return;
  getTodaySummary().then(setSummary);
  getTodayRecords().then(setMeals);
  getMealSuggestion().then(setMealSuggestion);  // ← 新增
}, [isLoggedIn]);
```

#### UI 结构改造

1. **今日状态区**：保留现有热量进度条 + 数据卡片，去掉 "AI 健康教练 Hero" 区块
2. **核心入口区**：改为两个并排按钮（📷 拍照识别 / ✍️ 手动搜索）
3. **AI 结果卡片**：新增，分析完成后展示 `decision + reason + suggestion + compensation`
4. **今日建议区**：新增，调用 `meal-suggestion` 接口
5. **今日记录列表**：保留
6. **底部导航**：简化为 4 个 tab（首页/分析/AI教练/我的），去掉挑战

### 4.2 AI 结果卡片交互流程

```
用户点击 📷 拍照识别
  → 跳转 /analyze 页面（已有）
  → 分析完成 → 返回首页时携带结果
  → 首页顶部显示 AI 结果卡片
  → 用户可「确认记录」或「重新分析」

或者（更好的体验）：
  → /analyze 页面内直接展示决策卡片
  → 确认记录后返回首页，首页自动刷新数据
```

**推荐**：在 `/analyze` 页面的结果步骤中嵌入决策卡片（不需要回首页），首页仅展示「今日建议」。

### 4.3 /analyze 页面结果步骤改造

```typescript
// apps/web/src/app/[locale]/analyze/page.tsx — result 步骤改造

// 现有：展示 foods 列表 + totalCalories + advice
// 改为：

{step === 'result' && result && (
  <div>
    {/* ═══ 新增：决策卡片（最醒目位置） ═══ */}
    <DecisionCard
      decision={result.decision}    // YES / NO / LIMITED
      reason={result.reason}
      suggestion={result.suggestion}
      compensation={result.compensation}
    />

    {/* ═══ 保留：食物列表（折叠展示） ═══ */}
    <FoodsList foods={editedFoods} onEdit={...} />

    {/* ═══ 保留：操作按钮 ═══ */}
    <div>
      <button onClick={handleSave}>确认记录</button>
      <button onClick={handleRetry}>重新分析</button>
    </div>
  </div>
)}
```

### 4.4 DecisionCard 组件设计

```typescript
// apps/web/src/components/decision-card.tsx

interface DecisionCardProps {
  decision: 'YES' | 'NO' | 'LIMITED';
  reason: string;
  suggestion: string;
  compensation: string;
}

const DECISION_CONFIG = {
  YES:     { emoji: '✅', label: '放心吃', color: 'bg-green-50 border-green-200 text-green-800' },
  LIMITED: { emoji: '⚠️', label: '控制份量', color: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
  NO:      { emoji: '🚫', label: '建议不吃', color: 'bg-red-50 border-red-200 text-red-800' },
};

export function DecisionCard({ decision, reason, suggestion, compensation }: DecisionCardProps) {
  const config = DECISION_CONFIG[decision];
  return (
    <div className={`rounded-2xl border-2 p-6 ${config.color}`}>
      {/* 决策标题 */}
      <div className="text-2xl font-bold mb-2">
        {config.emoji} {config.label}
      </div>

      {/* 原因 */}
      <p className="text-base mb-4">{reason}</p>

      {/* 建议 */}
      {suggestion && (
        <div className="mb-3">
          <span className="font-semibold">💡 建议：</span>
          <span>{suggestion}</span>
        </div>
      )}

      {/* 补救 */}
      {compensation && decision !== 'YES' && (
        <div>
          <span className="font-semibold">🏃 补救：</span>
          <span>{compensation}</span>
        </div>
      )}
    </div>
  );
}
```

### 4.5 useFood Hook 扩展

```typescript
// apps/web/src/lib/hooks/use-food.ts — 新增

getMealSuggestion: async () => {
  const res = await apiFetch('/api/app/food/meal-suggestion');
  return res.data;
},
```

### 4.6 前端 AnalysisResult 类型扩展

```typescript
// apps/web/src/lib/api/food.ts

export interface AnalysisResult {
  foods: FoodItem[];
  totalCalories: number;
  mealType: string;
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;

  // ═══ 新增 ═══
  decision: 'YES' | 'NO' | 'LIMITED';
  reason: string;
  suggestion: string;
  compensation: string;
}

// ═══ 新增 ═══
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

---

## 五、文件变更清单（实施 Checklist）

### 5.1 后端（apps/api-server/）

| 文件 | 操作 | 内容 |
|------|------|------|
| `src/app/services/analyze.service.ts` | **修改** | 1. 注入 FoodService + UserProfileService<br>2. 新增 `buildUserContext()` 方法<br>3. 替换 FOOD_ANALYSIS_PROMPT → V2（含 decision 字段）<br>4. `analyzeImage()` 新增 userId 参数<br>5. `parseAnalysisResult()` 解析 decision/reason/suggestion/compensation |
| `src/entities/food-record.entity.ts` | **修改** | 新增 4 列：decision, reason, suggestion, compensation |
| `src/app/dto/food.dto.ts` | **修改** | SaveFoodRecordDto 新增 4 个可选字段 |
| `src/app/controllers/food.controller.ts` | **修改** | 1. analyze 方法传入 user.id<br>2. 新增 `GET meal-suggestion` 端点 |
| `src/app/services/food.service.ts` | **修改** | 新增 `getMealSuggestion()` + `buildMealSuggestion()` + `getMealBudget()` |
| `src/migrations/XXXXXX-AddDecisionFields.ts` | **新建** | food_records 表新增 decision/reason/suggestion/compensation 列 |
| `src/app/app-client.module.ts` | **修改** | AnalyzeService 构造函数依赖调整（如需注入 FoodService） |

### 5.2 前端（apps/web/）

| 文件 | 操作 | 内容 |
|------|------|------|
| `src/pages-component/home/index.tsx` | **重构** | 1. 去掉 AI Hero 区块<br>2. 双入口按钮（拍照+手动搜索）<br>3. 新增今日建议卡片（meal-suggestion）<br>4. 简化底部导航（去掉挑战） |
| `src/app/[locale]/analyze/page.tsx` | **修改** | 结果步骤加入 DecisionCard 组件 |
| `src/components/decision-card.tsx` | **新建** | 决策卡片组件（YES/NO/LIMITED 三种状态） |
| `src/lib/api/food.ts` | **修改** | AnalysisResult 接口扩展 + MealSuggestion 接口 |
| `src/lib/hooks/use-food.ts` | **修改** | 新增 `getMealSuggestion()` |

### 5.3 不需要改动的部分

- ✅ Coach 模块（daily-greeting / 对话功能）→ 不受影响
- ✅ 用户档案（user-profile）→ 不受影响
- ✅ 食物库（food-library）→ 不受影响，后期可与推荐联动
- ✅ 认证系统 → 不受影响

---

## 六、数据库 Migration

```typescript
// apps/api-server/src/migrations/1744200000000-AddDecisionFields.ts

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDecisionFields1744200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        ADD COLUMN IF NOT EXISTS decision VARCHAR(10) DEFAULT 'YES',
        ADD COLUMN IF NOT EXISTS reason TEXT,
        ADD COLUMN IF NOT EXISTS suggestion TEXT,
        ADD COLUMN IF NOT EXISTS compensation TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        DROP COLUMN IF EXISTS decision,
        DROP COLUMN IF EXISTS reason,
        DROP COLUMN IF EXISTS suggestion,
        DROP COLUMN IF EXISTS compensation;
    `);
  }
}
```

---

## 七、API 接口汇总（改版后完整清单）

### 7.1 改动接口

```
# AI 分析（返回结构新增 decision/reason/suggestion/compensation）
POST /api/app/food/analyze
Body: FormData { image, mealType? }
Response: {
  requestId, foods[], totalCalories, mealType,
  decision, reason, suggestion, compensation,  ← 新增
  advice, isHealthy, imageUrl
}

# 保存记录（DTO 新增可选字段）
POST /api/app/food/records
Body: {
  ...existingFields,
  decision?, reason?, suggestion?, compensation?  ← 新增
}
```

### 7.2 新增接口

```
# 下一餐推荐（基于剩余热量的规则引擎推荐）
GET /api/app/food/meal-suggestion
Authorization: Bearer <token>
Response: {
  mealType: "dinner",
  remainingCalories: 1260,
  suggestion: {
    foods: "清蒸鱼 + 蒜炒青菜 + 半碗米饭",
    calories: 520,
    tip: "晚餐清淡为主"
  }
}
```

### 7.3 不变接口

```
GET  /api/app/food/records/today          ← 不变
GET  /api/app/food/records?page=&date=    ← 不变
GET  /api/app/food/summary/today          ← 不变
GET  /api/app/food/summary/recent?days=7  ← 不变
PUT  /api/app/food/records/:id            ← 不变
DELETE /api/app/food/records/:id          ← 不变
POST /api/app/coach/chat                  ← 不变
GET  /api/app/coach/daily-greeting        ← 不变
```

---

## 八、实施排期

### Day 1：后端核心改造

1. 新建 Migration（AddDecisionFields）
2. 修改 FoodRecord 实体（新增 4 列）
3. 修改 SaveFoodRecordDto（新增 4 字段）
4. 改造 analyze.service.ts（V2 prompt + userContext + 解析扩展）
5. 修改 food.controller（analyze 传 userId）
6. 运行迁移、本地测试

### Day 2：后端推荐 + 前端类型

1. food.service.ts 新增 `getMealSuggestion()`
2. food.controller 新增 `GET meal-suggestion`
3. 前端类型更新（AnalysisResult / MealSuggestion）
4. useFood hook 扩展

### Day 3：前端 UI 改造

1. 新建 DecisionCard 组件
2. /analyze 结果步骤嵌入 DecisionCard
3. 首页重构（状态区 + 双入口 + 今日建议 + 简化导航）
4. 联调测试

### Day 4：打磨 + 部署

1. AI prompt 调优（准确性测试 + 边缘情况）
2. 生产部署（Migration + 代码上线）
3. 端到端测试

---

## 九、后续优化方向

| 优化点 | 描述 | 优先级 |
|--------|------|--------|
| **食物库联动推荐** | meal-suggestion 从食物库随机匹配组合，替代硬编码 | P1 |
| **蛋白质/碳水追踪** | FoodItem 扩展 protein/carbs/fat 字段 | P2 |
| **分析结果缓存** | 相同图片 MD5 命中缓存，减少 AI 调用 | P1 |
| **个性化 Prompt** | 根据用户口味偏好/饮食历史调整 AI prompt | P2 |
| **情绪识别** | 识别用户是否暴食/焦虑，给出心理支持 | P3 |
| **挑战模块** | 从首页底部导航恢复，独立开发 | P2 |

---

## 十、与现有代码的关系总结

```
apps/api-server/src/
├── app/
│   ├── controllers/
│   │   ├── food.controller.ts        ← 修改：analyze 传 userId + 新增 meal-suggestion
│   │   ├── food-library.controller.ts  ← 不变
│   │   └── coach.controller.ts         ← 不变
│   ├── services/
│   │   ├── analyze.service.ts          ← 核心改造：V2 prompt + decision 字段
│   │   ├── food.service.ts             ← 修改：新增 getMealSuggestion()
│   │   ├── food-library.service.ts     ← 不变
│   │   ├── coach.service.ts            ← 不变
│   │   └── user-profile.service.ts     ← 不变
│   └── dto/
│       └── food.dto.ts                 ← 修改：SaveFoodRecordDto 新增字段
├── entities/
│   ├── food-record.entity.ts           ← 修改：新增 4 列
│   └── ...（其他不变）
└── migrations/
    └── XXXXXX-AddDecisionFields.ts     ← 新建

apps/web/src/
├── pages-component/home/index.tsx      ← 重构首页
├── app/[locale]/analyze/page.tsx       ← 修改结果步骤
├── components/decision-card.tsx        ← 新建
├── lib/api/food.ts                     ← 类型扩展
└── lib/hooks/use-food.ts              ← hook 扩展
```
