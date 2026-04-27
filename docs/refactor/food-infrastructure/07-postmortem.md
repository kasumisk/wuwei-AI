# 07 · Postmortem 模板（执行后回填）

> 本文件在重构 PR 合并后回填。模板照抄；执行中的偏差/教训写在对应小节。

## 概述

- 重构窗口：YYYY-MM-DD HH:MM ~ HH:MM
- 涉及人员：
- 数据规模（执行时）：foods N 行，embedding_v5 N 行，failed_fields 键数 N

## 关键时间线

| 时间 | 动作 | 结果 |
|---|---|---|
| | 备份 | |
| | apply migration A | |
| | 数据迁移脚本 | 耗时 X 分钟 |
| | 校验脚本 | OK / FAIL |
| | apply migration B | |
| | 重启服务 | |
| | 推荐流冒烟 | |

## 实测数据校验

| 项 | 旧值 | 新值 | 是否一致 |
|---|---|---|---|
| embedding 行数 (legacy_v4) | | | |
| embedding 行数 (openai_v5) | | | |
| field_sources 键总数 / provenance success 行数 | | | |
| failed_fields 键总数 / provenance failed 行数 | | | |
| foods 主表行数 | | | |

## 性能对比

| 指标 | main 分支 | refactor 分支 | 变化 |
|---|---|---|---|
| 推荐流 P50 | | | |
| 推荐流 P95 | | | |
| 向量召回单次 SQL 耗时 P95 | | | |
| food-pool-cache 全量加载耗时 | | | |
| enrichment 单字段 upsert 耗时 | | | |

## 偏差记录

> 计划与实际不一致的地方写在这里。

- 

## 教训 / 改进项

- 

## 后续 issue

- [ ] 
