/**
 * V6.1 Phase 1.4 — 统一食物分析结果结构
 *
 * V4.4: 本文件已重构为 barrel 文件，从各子文件 re-export 所有类型。
 * 外部模块的 import 路径无需修改。
 *
 * 子文件：
 * - user-context.types.ts  — 用户上下文相关
 * - food-item.types.ts     — 食物项和营养相关
 * - decision.types.ts      — 决策相关
 * - analysis.types.ts      — 分析结果核心类型
 * - pipeline.types.ts      — Pipeline 阶段中间类型
 * - constants.types.ts     — 裁剪常量
 */

export * from './user-context.types';
export * from './food-item.types';
export * from './decision.types';
export * from './analysis.types';
export * from './pipeline.types';
export * from './constants.types';
