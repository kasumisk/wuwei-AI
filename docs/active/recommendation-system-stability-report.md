# Recommendation System Stability Report

Generated: 2026-05-02T05:58:28.476Z

## 压测配置

- 连续稳定性: `recommendMeal` 60 次，同一用户；`daily plan regenerate` 50 次，同一用户。
- 并发压测: 20 / 50 / 100 并发，请求混合 `recommendMeal` 与 `recommendByScenario`。
- 长时间运行: 1000 次推荐调用，20 并发批处理。
- 学习系统: WeightLearner 实际反馈+重训；FactorLearner 被动链路 + 手工更新 + Redis fallback；StrategyAutoTuner 探索率与重启持久化。
- 极端输入: 空画像、预算 0、超大预算、缺失 region、非法 timezone、非法 channel。

## 并发情况

| concurrency | success | errorRate | avgMs | p95Ms | p99Ms | fallbackRate | scenarioErrorRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | 20/20 | 0 | 592.65 | 795 | 799 | 0 | 0 |
| 50 | 50/50 | 0 | 1140.2 | 1634 | 1639 | 0 | 0 |
| 100 | 100/100 | 0 | 2489.84 | 3298 | 3307 | 0 | 0 |

## 指标数据

| metric | value |
| --- | --- |
| 推荐一致性 same-input meal | 0.067 |
| 推荐一致性 same-input daily-plan | 0.02 |
| 推荐多样性 meal | 0.833 |
| 推荐多样性 daily-plan | 1 |
| cache 命中率 | 1 |
| 平均响应时间 | 801.14 |
| P95 延迟 | 3298 |
| P99 延迟 | 3307 |
| 错误率 | 0 |
| fallback 触发率 | 0.2 |
| learning 变化趋势 Weight deltaL1 | 0 |

## 连续调用稳定性

| case | consistency | diversity | explanationConsistency | driftRate | duplicateHitRate | abnormalHitRate | avgMs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| recommendMeal x60 | 0.067 | 0.833 | 0.067 | 1 | 0 | 0 | 77.97 |
| daily-plan regenerate x50 | 0.02 | 1 | 0.66 | 1 | 0.66 | 0 | 95.34 |

Top stable meal signatures:
- 4x 西红柿炒鸡蛋 > 拍黄瓜 > 麻婆豆腐 > Beans, black turtle, mature seeds, canned > Beans, baked, canned, plain or vegetarian || 621 || 38
- 4x 西红柿炒鸡蛋 > 炒豆芽 > 豆浆(甜) > 酸豆奶 > 牛肉干(长富牌) || 699 || 61
- 3x 西红柿炒鸡蛋 > 凉拌木耳 > 麻婆豆腐 > Beans, black turtle, mature seeds, canned > Beans, baked, canned, plain or vegetarian || 614 || 38
- 3x 西红柿炒鸡蛋 > 炒青菜 > 豆浆(甜) > 酸豆奶 > 牛肉干(长富牌) || 699 || 59
- 1x 炒饭（蛋炒饭） > 炒藕片 > 家常豆腐 > 酸菜鱼 > 牛肉干(长富牌) || 846 || 64

## Cache 行为验证

| prefix | before | after | sample |
| --- | --- | --- | --- |
| seasonality:region: | 0 | 3 | seasonality:region:CN<br/>seasonality:region:US<br/>seasonality:region:JP |
| health_mod: | 5251 | 5266 | health_mod:d9d60953f32c452b:376ea192-ddcf-4738-be9e-48de362d72b0:v1<br/>health_mod:927e35ec4f914b3f:e074fc1b-5133-435d-9d37-257b14d30815:v1<br/>health_mod:056273c193d96687:6a67a8b0-a417-4476-8d83-06f82bdb7ce2:v1<br/>health_mod:33b8e6200cf5fe51:c30de90e-e9c2-4e94-b7b9-b9b1690b7572:v1<br/>health_mod:128e8028c30a4c2c:623c7846-c4db-4624-853c-6b7ca0a3a82a:v1 |
| factor_learner: | 1 | 1 | factor_learner:1c8bd879-e15b-4aad-b101-a7506a0ce08a:fat_loss |
| weight_learner: | 0 | 0 | - |
| strategy:segment_map | 2 | 2 | strategy:segment_map:version<br/>strategy:segment_map |

- SeasonalityService memory regions: CN, US, AU, JP, GB
- Seasonality inflight preload count after tests: 0
- HealthModifier context hash isolation sample: dairy=6f437528bf9d428c, peanut=719dccc9ff9112a1
- FactorLearner redis key sample: factor_learner:1c8bd879-e15b-4aad-b101-a7506a0ce08a:fat_loss
- FactorLearner redis fields: {"price-fit":"1.238708","regional-boost":"1.119355","preference-signal":"1.179032","__feedbackCount":"36"}
- ProfileAggregator related cache observation: feedbackStatsCache.size=12
- cache counter delta: {"{\"tier\":\"l2\",\"operation\":\"get\",\"result\":\"hit\"}":690053,"{\"tier\":\"l2\",\"operation\":\"get\",\"result\":\"miss\"}":15,"{\"tier\":\"l1\",\"operation\":\"get\",\"result\":\"hit\"}":690053,"{\"tier\":\"l1\",\"operation\":\"get\",\"result\":\"miss\"}":15}

## 学习系统验证

### WeightLearner

| beforeSignature | afterSignature | changed | deltaL1 | convergedSecondRun | concentrationBefore | concentrationAfter |
| --- | --- | --- | --- | --- | --- | --- |
| 炒饭（蛋炒饭） > 干煸四季豆 > 家常豆腐 > 文蛤丸 > 烤鱼 || 819 || 53 | 西红柿炒鸡蛋 > 炒豆芽 > 豆浆(甜) > 牛肉干(长富牌) > 酸豆奶 || 699 || 61 | true | 0 | true | 0.083 | 0.083 |

### FactorLearner

| passiveFeedbackBefore | passiveFeedbackAfter | passiveActivated | minAdjustment | maxAdjustment | fallbackConsistent |
| --- | --- | --- | --- | --- | --- |
| 18 | 18 | false | 1.119355 | 1.238708 | false |

- manual factorAdjustments: {"preference-signal":1.179032,"price-fit":1.238708,"regional-boost":1.119355}

### StrategyAutoTuner

| interactions | convergence | rate |
| --- | --- | --- |
| 0 | 0 | 0.15 |
| 10 | 0.2 | 0.11401 |
| 50 | 0.5 | 0.054588 |
| 100 | 0.8 | 0.02 |
| 300 | 1 | 0.02 |

- exploration min/max: 0.02 / 0.15
- persisted after restart: true

## 长时间运行测试

| totalCalls | avgMs | p95Ms | p99Ms | errorRate | fallbackRate | first100Consistency | last100Consistency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 410.85 | 549 | 740 | 0 | 0 | 0.09 | 0.09 |

| memory | startMb | endMb | deltaMb |
| --- | --- | --- | --- |
| heapUsed | 1042.09 | 1152.76 | 110.67 |
| rss | 1299.69 | 1373.2 | 73.52 |

## 极端输入稳定性

| case | ok | fallbackOk | latencyMs | error |
| --- | --- | --- | --- | --- |
| empty-profile | true | true | 63 | - |
| budget-zero | true | true | 61 | - |
| budget-huge | true | true | 59 | - |
| region-missing | true | true | 114 | - |
| timezone-invalid | false | false | 27 | RangeError: Invalid time zone specified: Mars/Phobos |     at Date.toLocaleString (<anonymous>) |     at getUserLocalHour (/Users/xiehaiji/project/outsourcing/wuwei-AI/apps/api-server/src/common/utils/timezone.util.ts:43:10) |
| channel-invalid | true | true | 53 | - |

## 发现问题

- [P0] FactorLearner 未接入真实反馈链路: 提交真实反馈后 feedbackCount 仍为 18，说明线上反馈不会驱动 factorAdjustments。
- [P1] 长时间运行存在明显内存增长: heap +110.67MB, rss +73.52MB after 1000 calls.
- [P1] 同输入推荐存在明显漂移: meal consistency=0.067, meal drift=1, plan drift=1.
- [P1] 高并发下存在稳定性或性能瓶颈: 20并发 err=0, p99=799ms; 50并发 err=0, p99=1639ms; 100并发 err=0, p99=3307ms
- [P2] 极端输入未全部平稳降级: timezone-invalid: RangeError: Invalid time zone specified: Mars/Phobos |     at Date.toLocaleString (<anonymous>) |     at getUserLocalHour (/Users/xiehaiji/project/outsourcing/wuwei-AI/apps/api-server/src/common/utils/timezone.util.ts:43:10)

## 风险评估 (P0/P1/P2)

- P0: FactorLearner 未接入真实反馈链路
- P1: 长时间运行存在明显内存增长
- P1: 同输入推荐存在明显漂移
- P1: 高并发下存在稳定性或性能瓶颈
- P2: 极端输入未全部平稳降级

## 其他观测

- recommendation_traces for primary user: 0
- log warns/errors captured: 0/1
- seasonality missing-region warns: 0

## 是否适合上线

No - 存在 P0 风险，当前不适合上线。
