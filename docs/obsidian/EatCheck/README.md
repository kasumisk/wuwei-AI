---
title: EatCheck 项目文档
type: hub
status: active
created: 2026-05-13
tags:
  - EatCheck
  - architecture
  - project-docs
---

# EatCheck 项目文档

这是 EatCheck 的 Obsidian 项目文档入口。

## 核心文档

- [[全球主架构与中国区域化适配层]]
- [[Provider Abstraction 抽象清单]]
- [[Region Strategy 落地方案]]
- [[ADR - 全球主系统与中国区域适配]]
- [[实施路线图]]

## 当前总方向

EatCheck 应采用“全球主系统 + 中国区域化适配层”，而不是中国版和海外版双系统。

当前阶段重点不是正式进入中国大陆，而是把系统设计成未来可以接中国能力：

- Auth 可替换
- AI provider 可替换
- Billing provider 可替换
- Storage/Push/SMS/Moderation 可替换
- 核心推荐、用户画像、食物库、订阅权益保持统一

## 本地源文件

完整长文版本位于项目仓库：

`docs/active/EATCHECK_REGION_PROVIDER_ABSTRACTION_ARCHITECTURE.md`
