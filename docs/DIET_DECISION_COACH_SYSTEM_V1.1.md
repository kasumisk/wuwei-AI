# 饮食决策 + AI教练系统 V1.1

> 版本: V1.1 | 基于 V1.0 的缺陷修复与能力升级

---

## 一、V1.0 → V1.1 核心升级点

| #   | V1.0 缺陷                                     | V1.1 改进                                                     |
| --- | --------------------------------------------- | ------------------------------------------------------------- |
| 1   | 替代方案 100% 硬编码（~30 个静态食物名）      | 接入推荐引擎 `SubstitutionService.findSubstitutes()` 动态生成 |
| 2   | 食物匹配精度低（substring 匹配 + 静态置信度） | 改用 `sim_score` 排序 + 动态置信度 + 多候选消歧               |
| 3   | 零国际化（所有字符串硬编码中文）              | 接入 `t()` i18n 框架，支持 zh-CN / en-US / ja-JP              |
| 4   | 决策建议中硬编码食物名（"搭配鸡胸肉或鸡蛋"）  | 从推荐引擎获取个性化建议                                      |
| 5   | LLM Prompt 仅中文                             | Prompt 支持多语言指令                                         |
| 6   | Coach 建议全部硬编码中文字符串                | Coach 系统 i18n 化                                            |

---

## 二、当前系统能力分析（Step 1）

### 已具备

| 层   | 能力                   | 实现                                                        |
| ---- | ---------------------- | ----------------------------------------------------------- |
| 分析 | 食物识别（标准库+LLM） | `TextFoodAnalysisService.matchFoodLibrary()` + LLM fallback |
| 分析 | 营养计算（12维）       | 标准库 per-100g 换算 + LLM 估算                             |
| 分析 | 7维综合评分            | `NutritionScoreService.calculateMealScore()`                |
| 决策 | 评分驱动决策           | `scoreToFoodDecision()` ≥75/55/35 三档                      |
| 决策 | 时间感知               | 宵夜重罚 / 晚间碳水 / 早餐容忍                              |
| 决策 | 上下文感知             | 当日摄入 `todaySummary`                                     |
| 教练 | 对话式 AI 教练         | `CoachService` + LLM                                        |
| 教练 | 3种人格风格            | 严格/温暖/专业                                              |
| 教练 | 行为画像整合           | `BehaviorService.getBehaviorContext()`                      |

### V1.1 需修复的缺陷

| #   | 缺陷                                                 | 影响                                         | 修复方案                                         |
| --- | ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| 1   | `generateAlternatives()` 完全使用静态规则配置        | 替代方案不考虑用户偏好、过敏原、实际食物库存 | 改为调用 `SubstitutionService.findSubstitutes()` |
| 2   | `matchFoodLibrary()` 取 `find()` 第一个匹配，无排序  | "鸡" 可能匹配到 "鸡翅" 而非 "鸡胸肉"         | 改用 `sim_score` 最高分匹配                      |
| 3   | 置信度固定 0.95/0.7                                  | 无法反映实际匹配质量                         | 基于 `sim_score` 动态计算                        |
| 4   | `generateDecisionAdvice()` 硬编码 "搭配鸡胸肉或鸡蛋" | 对素食者/过敏用户不适用                      | 从推荐引擎获取个性化补充建议                     |
| 5   | 所有用户面向字符串为中文                             | 无法服务非中文用户                           | 使用 `t(key, vars, locale)`                      |
| 6   | Coach `PERSONA_PROMPTS` / suggestions 硬编码中文     | 同上                                         | i18n 化                                          |

---

## 三、分阶段实施计划

### Phase 1: 分析精度 + 动态替代（6个任务）

| ID   | 任务                                                                  | 修改文件                        |
| ---- | --------------------------------------------------------------------- | ------------------------------- |
| P1-1 | 食物匹配精度提升：使用 `sim_score` 排序最佳匹配                       | `text-food-analysis.service.ts` |
| P1-2 | 动态置信度：基于 `sim_score` 计算而非固定值                           | `text-food-analysis.service.ts` |
| P1-3 | 注入 `SubstitutionService`，`generateAlternatives()` 改为推荐引擎驱动 | `text-food-analysis.service.ts` |
| P1-4 | `generateDecisionAdvice()` 去除硬编码食物名，从推荐引擎获取           | `text-food-analysis.service.ts` |
| P1-5 | 保留静态规则作为 fallback（推荐引擎无结果时）                         | `text-food-analysis.service.ts` |
| P1-6 | 清理不再使用的硬编码时间感知替代（温牛奶等）                          | `text-food-analysis.service.ts` |

### Phase 2: i18n 国际化 — 分析+决策层（5个任务）

| ID   | 任务                                                         | 修改文件                                     |
| ---- | ------------------------------------------------------------ | -------------------------------------------- |
| P2-1 | 新增决策系统 i18n keys 到 `i18n-messages.ts`                 | `i18n-messages.ts`                           |
| P2-2 | `text-food-analysis.service.ts` 所有用户面向字符串改用 `t()` | `text-food-analysis.service.ts`              |
| P2-3 | `alternative-food-rules.ts` 的食物名/reason 改用 i18n keys   | `alternative-food-rules.ts`                  |
| P2-4 | LLM Prompt 支持多语言（根据 locale 切换指令语言）            | `text-food-analysis.service.ts`              |
| P2-5 | `analyze()` 接口接收 `locale` 参数并透传                     | `text-food-analysis.service.ts` + controller |

### Phase 3: i18n 国际化 — AI教练层（4个任务）

| ID   | 任务                                                          | 修改文件                               |
| ---- | ------------------------------------------------------------- | -------------------------------------- |
| P3-1 | `PERSONA_PROMPTS` 改用 i18n keys                              | `coach.service.ts`                     |
| P3-2 | `getPersonalizedSuggestions()` / `getDailyGreeting()` i18n 化 | `coach.service.ts`                     |
| P3-3 | Coach system prompt 支持多语言                                | `coach.service.ts`                     |
| P3-4 | Coach controller 接收 `locale` 并透传                         | `coach.controller.ts` + `coach.dto.ts` |

---

## 四、决策链路（Step 5）

```
用户输入（"想吃炸鸡"）
  │
  ├─ 1. 预处理 + 拆词
  ├─ 2. matchFoodLibrary()  ← V1.1: sim_score 排序 + 动态置信度
  ├─ 3. buildUserContext()  ← 读取目标/当日摄入/时间
  ├─ 4. calculateTotals() + calculateScore()  ← 7维评分
  ├─ 5. computeDecision()  ← 评分驱动 + 时间感知 + 上下文感知
  ├─ 6. generateAlternatives()  ← V1.1: SubstitutionService 动态生成
  ├─ 7. generateDecisionAdvice()  ← V1.1: 推荐引擎个性化建议
  ├─ 8. generateExplanation()
  └─ 9. 组装 FoodAnalysisResultV61 → 返回前端
         │
         └─ 可选: 跳转 AI 教练 → 对话式引导
```

---

## 五、API 能力设计（Step 6）

| 能力     | 已有 API                        | V1.1 变更                              |
| -------- | ------------------------------- | -------------------------------------- |
| 饮食分析 | `POST /food/analyze-text`       | 新增 `locale` 参数                     |
| 决策判断 | 内嵌于分析流程                  | 无新接口，内部升级                     |
| 替代建议 | `GET /food/substitutes/:foodId` | 分析流程内部复用 `SubstitutionService` |
| AI教练   | `POST /coach/message`           | 新增 `locale` 参数                     |
| 每日问候 | `GET /coach/greeting`           | 新增 `locale` 参数                     |

---

## 六、数据结构（Step 7）

**不新增数据库字段**。所有变更仅在运行时数据结构层面：

- `FoodAlternative.foodLibraryId?: string` — 当替代来自推荐引擎时，携带标准库 ID
- `FoodAlternative.score?: number` — 替代方案的推荐得分
- `AnalyzedFoodItem.confidence` — 从固定值改为基于 sim_score 的动态值

---

## 七、防跑偏机制

- 推荐系统：只读取 `SubstitutionService.findSubstitutes()` 结果，不修改推荐逻辑
- 用户画像系统：只读取 profile 和 behavior，不修改
- 商业化：不涉及
- 数据库：不增加字段
