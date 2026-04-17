# 饮食决策 + AI教练系统 V3.0 设计文档

**版本**: V3.0  
**基线**: V2.9（分析完整度评分、决策护栏、复核级别）  
**设计日期**: 2026-04-17  
**状态**: 实施中

---

## 一、V2.9 现有能力总结

| 层级   | 已有能力                                                              |
| ------ | --------------------------------------------------------------------- |
| 分析层 | 分析质量分层(high/medium/low)、完整度评分(0-1)、复核级别(auto/manual) |
| 决策层 | 动态决策提示、健康约束优先级、决策护栏(≤3条)                          |
| 教练层 | 护栏/复核级别/决策置信度输出到 prompt                                 |
| i18n   | zh-CN / en-US / ja-JP，覆盖 V2.9 五个新标签                           |

---

## 二、V3.0 优化目标（6个）

### 目标1 — 决策信号追踪（Signal Trace）

**问题**: 当前决策结论"存在"但"为什么"不可追溯，signals 散落各处  
**方案**: `DecisionSummary.signalTrace: SignalTraceItem[]` — 有序信号列表，含权重+来源字段  
**价值**: 可解释性、可调试、教练 prompt 直接消费

### 目标2 — 宏量槽位感知（Macro Slot Awareness）

**问题**: `budgetStatus` 只跟踪热量，蛋白/脂肪/碳水缺口对决策不可见  
**方案**: `UnifiedUserContext.macroSlotStatus: MacroSlotStatus` — 四维宏量各自 deficit/excess/ok 状态  
**价值**: 决策和教练可说出"你今天蛋白质缺口30g"而非仅"你超了卡路里"

### 目标3 — 语气决策引擎（Tone Resolution Engine）

**问题**: `coach-tone.config.ts` 有人格 prompt 但未和决策结果动态绑定  
**方案**: `DecisionToneResolverService` — inputGivenGoalType + verdict + coachFocus → 解析出 tone modifier string  
**价值**: 减脂用户+avoid → 控制型语气；增肌用户+recommend → 鼓励型语气，AI coach 自动适配

### 目标4 — 替代方案质量评分（Alternative Quality Ranking）

**问题**: alternatives[] 有候选但无排序依据说明，前端/教练不知道"为什么推荐这个"  
**方案**: `FoodAlternative.rankScore: number` + `rankReasons: string[]` — 评分标准可追溯  
**价值**: 教练可说"建议换成XX(+15%蛋白，-30%脂肪)"，替代方案更可信

### 目标5 — Coach解释节点化（Explanation Nodes）

**问题**: `EvidencePack.decisionEvidence[]` 是平铺字符串，无因果顺序  
**方案**: `EvidencePack.explanationNodes: ExplanationNode[]` — 结构化解释步骤，每步有 source 标注  
**价值**: 教练可按节点顺序输出逻辑清晰的解释

### 目标6 — i18n 覆盖扩展

**方案**: 为目标1-5 新增标签，覆盖3个locale

---

## 三、数据结构扩展

### 新增类型

```typescript
// 目标1: 信号追踪
interface SignalTraceItem {
  signal: string; // signal key (e.g. 'protein_gap')
  priority: number; // 权重分值
  source: 'user_context' | 'nutrition' | 'health_constraint' | 'time_window';
  description: string; // 人类可读说明
}

// 目标2: 宏量槽位
interface MacroSlotStatus {
  calories: 'deficit' | 'ok' | 'excess';
  protein: 'deficit' | 'ok' | 'excess';
  fat: 'deficit' | 'ok' | 'excess';
  carbs: 'deficit' | 'ok' | 'excess';
  /** 缺口最大的宏量 */
  dominantDeficit?: 'protein' | 'fat' | 'carbs' | 'calories';
  /** 超标最大的宏量 */
  dominantExcess?: 'protein' | 'fat' | 'carbs' | 'calories';
}

// 目标5: 解释节点
interface ExplanationNode {
  step: number;
  source: string; // e.g. 'nutrition_analysis' | 'user_goal' | 'health_constraint'
  content: string;
  weight?: 'high' | 'medium' | 'low';
}
```

### 扩展现有类型

- `UnifiedUserContext` + `macroSlotStatus?: MacroSlotStatus`
- `DecisionSummary` + `signalTrace?: SignalTraceItem[]`
- `FoodAlternative` + `rankScore?: number`, `rankReasons?: string[]`
- `EvidencePack` + `explanationNodes?: ExplanationNode[]`

---

## 四、分阶段迭代

### Phase 1 — 类型 + 宏量槽位 + 信号追踪（分析层）

1. `analysis-result.types.ts` — 新增4个接口+扩展现有3个接口
2. `user-context-builder.service.ts` — 计算 `macroSlotStatus`
3. `decision-summary.service.ts` — 计算 `signalTrace`，排序来自 signal-priority.config.ts

### Phase 2 — 语气引擎 + 替代方案评分（决策层）

1. 新建 `decision-tone-resolver.service.ts` — 纯函数解析语气修饰符
2. `alternative-suggestion.service.ts` — 为 alternatives 附加 rankScore + rankReasons
3. `analysis-pipeline.service.ts` — 将 macroSlotStatus 注入 userContext，将 tone 写入 evidencePack

### Phase 3 — Coach prompt + i18n

1. `coach-prompt-builder.service.ts` — 输出 signalTrace、tone modifier、explanationNodes
2. `decision-labels.ts` — 新增 8个标签 × 3 locale

---

## 五、禁止修改范围（继承V2.9）

- ❌ 推荐系统、用户画像系统
- ❌ 订阅/商业化逻辑
- ❌ 新增数据库字段
- ❌ 新增 NestJS 模块

---

## 六、测试策略

- 文件: `src/v3.0-integration.spec.ts`
- Phase 1: 宏量槽位计算(4用例) + 信号追踪排序(4用例)
- Phase 2: 语气解析(6用例) + 替代方案评分(4用例)
- Phase 3: i18n完整性(12用例)

目标: 30 tests passing

---

## 七、下一版本方向（V3.1 预告）

- 吃后补偿建议智能化（recovery action与信号追踪联动）
- 教练推送：基于信号追踪生成主动消息
- 多日趋势分析接入决策链（当前仅支持今日）
