# 饮食决策 + AI教练系统 V3.1 设计文档

**版本**: V3.1  
**基线**: V3.0（Signal Trace、Macro Slot Awareness、Tone Resolution Engine、Alternative Ranking、Explanation Nodes）  
**设计日期**: 2026-04-17  
**状态**: 实施中

---

## 一、V3.0 现有能力总结

| 层级 | 已有能力 |
|------|---------|
| 分析层 | MacroSlotStatus（四维宏量槽位）、SignalTraceItem（信号追踪列表）|
| 决策层 | ToneResolverService（语气引擎）、Alternative rankScore + rankReasons |
| 教练层 | ExplanationNodes（解释节点）、toneModifier 注入 prompt |
| i18n  | V3.0 新增 8 个标签 × 3 locale |

---

## 二、V3.1 优化目标（6个）

### 目标1 — 动态信号权重调整（Dynamic Signal Weight Adjustment）

**问题**: `signal-priority.config.ts` 是静态权重矩阵，不感知用户当天的实际宏量状态  
**方案**: 新增 `DynamicSignalWeightService.adjustWeights(baseWeights, macroSlotStatus, goalType)` — 返回运行时调整后的权重 map；`decision-summary.service.ts` 的 `buildSignalTrace()` 调用此服务替代静态优先级  
**规则**:
- `macroSlotStatus.protein === 'deficit'` → `protein_gap` 权重 × 1.4
- `macroSlotStatus.calories === 'excess'` → `over_limit` 权重 × 1.3
- `macroSlotStatus.fat === 'excess'` → `fat_excess` 权重 × 1.2
- `goalType === 'muscle_gain'` 且 protein deficit → `protein_gap` 额外 × 1.2（叠乘）

### 目标2 — 置信度分级驱动 Prompt 深度（Confidence-Driven Prompt Depth）

**问题**: `ConfidenceDiagnostics.reviewLevel` 已存在，但未驱动 prompt 内容丰富程度  
**方案**: 新增 `PromptDepthLevel: 'brief' | 'standard' | 'detailed'`；基于 `reviewLevel + analysisCompletenessScore` 推导：
- `reviewLevel === 'manual' || score < 0.5` → `detailed`（更多免责 + 解释）
- `score >= 0.8 && reviewLevel === 'auto'` → `brief`（精简版）
- 其余 → `standard`  

`EvidencePack` 扩展 `promptDepth?: PromptDepthLevel`；`coach-prompt-builder` 根据此值控制段落省略。

### 目标3 — 教练输出结构化（Structured Coach Output Schema）

**问题**: `EvidencePack.decisionEvidence[]` 和 `explanationNodes[]` 提供了原料，但教练最终输出还是大段文本，无法被前端解构  
**方案**: 新增 `CoachOutputSchema` 接口，`EvidencePack` 扩展 `structuredOutput?: CoachOutputSchema`；由 `evidence-pack-builder.service.ts` 组装，供 prompt 消费：

```typescript
interface CoachOutputSchema {
  verdict: 'recommend' | 'caution' | 'avoid';
  mainReason: string;        // 1-2句核心原因
  actionSteps: string[];     // 2-3条可执行建议
  cautionNote?: string;      // 警告/免责（可选）
  confidenceNote?: string;   // 置信度说明（detailed 模式专用）
}
```

### 目标4 — 每日宏量摘要文本（Daily Macro Summary Text）

**问题**: `MacroSlotStatus` 是结构化枚举，教练需要自己推算"今天还差多少蛋白质"，增加 prompt 推理负担  
**方案**: 新增 `DailyMacroSummaryService.buildSummaryText(ctx, locale)` — 输出一段自然语言摘要文本（如"今天已摄入 1620 kcal，蛋白质差 28g，脂肪略超"），直接嵌入 coach prompt，降低 AI 自推断误差

### 目标5 — 吃后恢复联动 SignalTrace（Post-Meal Recovery + Signal Trace）

**问题**: `PostMealRecoveryService` 只依赖 `macroProgress`，未感知 `signalTrace` 的 `dominantDeficit`/`dominantExcess`  
**方案**: `PostMealRecoveryService.build()` 接收可选的 `signalTrace?: SignalTraceItem[]`；当 signalTrace 存在时，优先从 top-1 信号的 source 方向生成 nextMealDirection（比单纯百分比更精准）

### 目标6 — i18n 扩展（8个新标签）

为目标1-5 产生的新 key 各增加 zh-CN / en-US / ja-JP 翻译：
`promptDepthLabel` / `dynamicWeightLabel` / `structuredOutputLabel` / `verdictLabel2` / `mainReasonLabel` / `actionStepsLabel` / `cautionNoteLabel` / `macroSummaryLabel`

---

## 三、数据结构扩展

```typescript
// 目标2: Prompt 深度
type PromptDepthLevel = 'brief' | 'standard' | 'detailed';

// 目标3: 结构化教练输出
interface CoachOutputSchema {
  verdict: 'recommend' | 'caution' | 'avoid';
  mainReason: string;
  actionSteps: string[];
  cautionNote?: string;
  confidenceNote?: string;
}

// EvidencePack 新增字段
interface EvidencePack {
  // ...existing fields...
  /** V3.1: Prompt 输出深度驱动 */
  promptDepth?: PromptDepthLevel;
  /** V3.1: 结构化教练输出模板 */
  structuredOutput?: CoachOutputSchema;
  /** V3.1: 每日宏量摘要自然语言 */
  dailyMacroSummary?: string;
}
```

---

## 四、服务层扩展

| 服务 | 位置 | 变更 |
|------|------|------|
| `DynamicSignalWeightService` | `decision/config/` | 新增，纯函数，无 IO |
| `DailyMacroSummaryService` | `decision/decision/` | 新增，`buildSummaryText()` |
| `PostMealRecoveryService` | `decision/decision/` | 扩展，接收 signalTrace |
| `EvidencePackBuilderService` | `decision/analyze/` | 扩展：填充 promptDepth + structuredOutput + dailyMacroSummary |
| `CoachPromptBuilderService` | `coach/app/prompt/` | 扩展：根据 promptDepth 控制段落长度 |
| `DecisionSummaryService` | `decision/decision/` | 扩展：buildSignalTrace() 调用动态权重 |

---

## 五、分阶段实施

### Phase 1（目标1+2）
1. 新增 `DynamicSignalWeightService` 纯函数服务
2. 类型扩展：`PromptDepthLevel` + `EvidencePack.promptDepth`
3. `DecisionSummaryService.buildSignalTrace()` 调用动态权重
4. `EvidencePackBuilderService` 计算并填充 `promptDepth`

### Phase 2（目标3+4）
1. 类型扩展：`CoachOutputSchema` + `EvidencePack.structuredOutput` + `dailyMacroSummary`
2. 新增 `DailyMacroSummaryService`
3. `EvidencePackBuilderService` 填充 `structuredOutput` + `dailyMacroSummary`

### Phase 3（目标5+6）
1. `PostMealRecoveryService` 联动 `signalTrace`
2. `CoachPromptBuilderService` 根据 `promptDepth` 控制段落省略
3. i18n 8个新标签
4. 编写并运行集成测试

---

## 六、测试覆盖

- Phase 1：`DynamicSignalWeightService` 权重调整逻辑 × 4 cases；promptDepth 推导 × 3 cases
- Phase 2：`DailyMacroSummaryService` 输出文本 × 3 locale；structuredOutput 填充 × 2 cases
- Phase 3：`PostMealRecovery` signalTrace 联动 × 3 cases；i18n 新标签 × 8 keys

**目标**: ≥ 28 tests pass
