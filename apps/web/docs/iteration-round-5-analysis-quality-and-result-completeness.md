# Round 5: 分析过程与结果完善（输入质量 + 结果完整度）

> 日期: 2026-04-17
> 目标: 提升分析前输入质量与分析后结果可执行性，减少“有结果但不好执行”的体验断层
> 范围: `analyze-page.tsx`（前端交互增强，无后端 API 变更）

---

## Step 1：用户画像与档案评估

本轮不新增画像字段；仍依赖：

- goal / activityLevel
- dietaryRestrictions / allergens / healthConditions

用户需要提供什么（本轮新增引导）：

- 文字分析时尽量提供 **份量**（如 100g/半碗/2个）
- 尽量提供 **做法**（如油炸/清蒸/红烧）

API 是否要改：

- 当前无需改 API。
- 输入质量提升通过前端引导完成。

---

## Step 2：核心用户流程（文字流程图）

```text
用户进入分析页
  -> 选择图片或文字分析
  -> 输入阶段看到“输入完善建议”（份量/做法）
    -> 一键补充份量提示（文字模式）
  -> 发起分析
  -> 结果页查看“分析完整度面板”（分数/覆盖率/补强建议）
  -> 根据建议选择：
       A. 重新分析补全信息
       B. 继续问 AI 教练做分项复盘
       C. 保存记录
```

---

## Step 3：页面结构设计（可落地）

涉及页面：

- `/analyze`

页面功能新增：

- 输入阶段
  - 图片模式：拍摄质量提示卡
  - 文字模式：输入完善建议卡（份量/做法检测 + 一键补提示）

- 结果阶段
  - 分析完整度面板（完整度分数、宏量覆盖率、分维度评分状态、补强建议）

API 对应：

- `POST /app/food/analyze/text`
- `POST /app/food/analyze/image`
- `POST /app/food/records` / `POST /app/food/analysis/save`

---

## Step 4：交互优化（关键）

不是改 UI，而是优化行为路径：

- 把“分析质量问题”前置到输入阶段（减少无效分析）
- 把“结果怎么补强”显性化到结果阶段（避免用户只看结论）

行为收益：

- 减少低质量输入导致的误差
- 提升用户理解和纠偏能力
- 提升“结果 -> 行动”的转化效率

---

## Step 5：UI 结构设计（组件级）

本轮新增逻辑（在 `AnalyzePage` 内）：

- `hasQuantityHint(text)`：检测文本是否包含份量
- `hasCookingHint(text)`：检测文本是否包含做法
- `computeResultQuality(result, foods)`：计算结果完整度

新增区块：

- 输入完善建议卡（upload/text）
- 图片准确度提示卡（upload/image）
- 分析完整度面板（result）

状态来源：

- API 状态：`analyzeImage` / `analyzeText` 结果
- 本地状态：`textInput`、`editedFoods`、`result`

---

## Step 6：API 缺口识别

当前可运行，但还有后续空间：

- 缺口 1: 后端未直接返回“分析完整度/可信度等级”，前端只能估算
  - 建议新增字段：`analysisQualityBand`、`analysisCompletenessScore`

- 缺口 2: 没有“缺失信息提示”结构化输出
  - 建议新增字段：`missingSignals[]`（如 `missing_portion`, `missing_cooking_method`）

---

## Step 7：分阶段迭代

Phase 1（已完成）

- 输入前置引导（份量/做法）
- 结果完整度面板（分数+补强建议）

Phase 2（下一轮）

- 增加“低完整度一键重分析”引导流程
- 结果面板接入教练分项复盘按钮模板

Phase 3（后续）

- 与后端统一完整度标准（后端输出 + 前端展示一致）
- 形成“分析质量追踪”周趋势（用户可见）

---

## 本轮落地文件

- `apps/web/src/features/food-analysis/components/analyze-page.tsx`
- `apps/web/docs/iteration-round-5-analysis-quality-and-result-completeness.md`
