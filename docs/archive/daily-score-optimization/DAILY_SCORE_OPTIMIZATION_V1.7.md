# Daily Score Optimization V1.7 — Admin 权重配置 UI

> 基于 V1.6（验证增强 + 结构化状态 + Admin API），V1.7 新增完整的 **Admin 权重配置管理页面**，让 Admin 无需直接调用 API 即可可视化配置每日评分权重。

---

## 1. V1.7 目标

| #      | 目标              | 描述                                                               |
| ------ | ----------------- | ------------------------------------------------------------------ |
| G1-G5  | 继承 V1.6         | 所有 V1.6 能力（结构化状态、per-macro 偏离、验证、defaults）均保持 |
| **G6** | **Admin 配置 UI** | 完整的 Admin 后台配置页面，可视化展示 + 表单编辑权重               |

---

## 2. 新增内容（V1.7 增量）

### 2.1 Admin 页面路由

```
/recommendation/scoring/weights
```

挂载在推荐引擎模块下，命名为"每日评分权重"。

### 2.2 Admin UI 功能

| 功能               | 描述                                             |
| ------------------ | ------------------------------------------------ |
| 查看当前配置       | 展示当前生效的权重（config 或 default）          |
| 查看默认值         | 侧边对比展示硬编码默认值                         |
| 按目标类型编辑权重 | Tab 切换 fat_loss / muscle_gain / health / habit |
| 权重分布可视化     | 进度条直观展示各维度权重占比                     |
| 健康条件倍数编辑   | 可编辑 healthConditionMultipliers                |
| 前端权重总和校验   | 实时显示当前总和，不足或超过 1.0 即时提示        |
| 一键重置默认       | 将当前 Tab 的权重恢复为硬编码默认值              |
| 保存配置           | 调用 PUT 接口，展示验证错误                      |
| 缓存延迟提示       | 提示用户"生效延迟约 1 分钟"                      |

### 2.3 前端文件

```
apps/admin/src/
├── services/
│   └── scoringConfigService.ts  ← 新增 daily score weights 相关 API + hooks
├── pages/recommendation/
│   └── scoring/
│       ├── index.tsx             ← 路由配置（子模块入口）
│       └── weights/
│           └── index.tsx         ← 每日评分权重配置主页面
```

### 2.4 后端不变

V1.6 已完成全部后端实现，V1.7 仅新增前端页面。

---

## 3. 评分维度说明（UI 展示用）

| 维度 key       | 中文名     | 含义说明                 |
| -------------- | ---------- | ------------------------ |
| energy         | 热量达成   | 热量摄入与目标的接近程度 |
| proteinRatio   | 蛋白质比例 | 蛋白质占热量比例是否达标 |
| macroBalance   | 宏量均衡   | 碳水/脂肪比例均衡度      |
| foodQuality    | 食物质量   | 食物营养密度评分         |
| satiety        | 饱腹感     | 饱腹感指数               |
| stability      | 习惯稳定性 | 连胜天数、餐次规律       |
| glycemicImpact | 血糖影响   | 血糖负荷（GL）评分       |
| mealQuality    | 餐食质量   | 每餐决策综合质量         |

---

## 4. 权重调整设计原则

1. 8 维度权重总和必须 = 1.0（±0.05 容差）
2. 提高某维度 = 降低其他维度（零和）
3. 前端实时显示权重总和，超范围高亮警告
4. 健康条件倍数 0.1-5.0，是乘法调整，自动重新归一化
5. 配置更新后约 1 分钟缓存延迟

---

## 5. 接口定义（已在 V1.6 实现）

```
GET  /api/admin/scoring-config/daily-score-weights
     → { current: DailyScoreWeightsConfig | null, defaults: {...}, effectiveSource: 'config'|'default' }

GET  /api/admin/scoring-config/daily-score-weights/defaults
     → { goalWeights: {...}, healthConditionMultipliers: {...} }

PUT  /api/admin/scoring-config/daily-score-weights
     Body: DailyScoreWeightsConfig
     → 200 OK | 400 BadRequest { errors: string[] }
```
