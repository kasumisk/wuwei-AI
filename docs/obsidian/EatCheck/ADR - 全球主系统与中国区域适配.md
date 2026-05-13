---
title: ADR - 全球主系统与中国区域适配
type: adr
status: accepted
created: 2026-05-13
tags:
  - EatCheck
  - ADR
  - architecture
---

# ADR - 全球主系统与中国区域适配

## ADR-001：不做中国版重写

决策：采用“全球主系统 + 中国区域适配层”。

原因：

- EatCheck 的核心复杂度在 AI 分析、推荐、用户画像、食物数据库和订阅权益。
- 双系统会导致模型质量、数据口径、实验结果和研发节奏全部分裂。
- 中国能力应该作为 provider 和 region strategy 接入，而不是重写业务系统。

## ADR-002：Phase 1 不做双数据库

决策：当前不做 Global/CN 双数据库。

原因：

- 双数据库会引入数据同步、账号迁移、订阅权益一致性和 usage 统计问题。
- 当前阶段只需要 region-aware provider routing。
- 真正的数据驻留问题应等中国运营主体、合规目标和商业目标明确后再进入 Phase 3。

## ADR-003：Flutter 单包，能力由服务端下发

决策：Flutter 保持单包，登录方式、支付方式、AI 能力和合规提示由 `/api/app/capabilities` 下发。

原因：

- 客户端 hardcode 区域差异会增加审核、灰度、配置和运营复杂度。
- 服务端配置可以快速切换 provider 和灰度策略。

## ADR-004：AI 统一走服务端 Gateway

决策：App 不直连 AI provider，业务模块也应逐步避免直连 provider。AI 请求进入 NestJS Gateway/LLM Router 后由 region、capability、quota、cost、fallback 策略决策。

原因：

- AI 是成本、稳定性、合规和体验的共同风险点。
- 服务端集中治理可以统一观测、限流、熔断、审计和 fallback。

## 风险提醒

- 不要把 CN 当成默认 region。
- 不要让中国合规需求污染全球主流程。
- 不要把 RevenueCat、Firebase、OpenAI 当成核心业务依赖。
- 不要在核心推荐逻辑里写 provider/region 分支。
- 不要过早做双集群、双库、双 app。
