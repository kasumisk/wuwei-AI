/**
 * I18n V8 — Runtime Singleton Accessor
 *
 * 目的：
 *   让"非 NestJS DI 上下文"的纯函数（cl() / 模块顶层 const / 配置文件）
 *   也能调用全局 I18nService.translate()，从而让整个仓库共享同一套
 *   字典 / locale 解析 / 占位符 interpolation 逻辑。
 *
 * 设计：
 *   - I18nService.onModuleInit() 在 loadAll 完成后调用 setI18nSingleton(this)
 *   - 纯函数适配器（如 decision/i18n/decision-labels.ts 的 cl()）通过
 *     getI18nSingleton() 获取实例
 *   - 在 singleton 未就绪期间（NestJS 启动早期 / 单元测试 / 模块顶层 eager
 *     执行），调用方应自己提供 fallback 数据源 — 这里只暴露 nullable accessor
 *
 * Anti-pattern 防御：
 *   - **不要**在业务模块直接 import 此文件并绕过 cl() 调用 translate；
 *     业务模块仍应注入 I18nService。本 singleton 仅服务于必须以纯函数
 *     形式存在的 i18n 适配器层。
 */

import type { I18nService } from './i18n.service';

let singleton: I18nService | null = null;

export function setI18nSingleton(svc: I18nService): void {
  singleton = svc;
}

export function getI18nSingleton(): I18nService | null {
  return singleton;
}

/** 测试场景：清空 singleton（避免跨用例污染） */
export function clearI18nSingleton(): void {
  singleton = null;
}
