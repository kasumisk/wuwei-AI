import { Injectable } from '@nestjs/common';
import { BaseCapabilityAdapter } from './base.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { DeepSeekAdapter } from './deepseek.adapter';
import { QwenAdapter } from './qwen.adapter';

/**
 * 适配器工厂
 * 根据提供商名称返回对应的适配器实例
 */
@Injectable()
export class AdapterFactory {
  private readonly adapters: Map<string, BaseCapabilityAdapter>;

  constructor(
    private readonly openaiAdapter: OpenAIAdapter,
    private readonly deepseekAdapter: DeepSeekAdapter,
    private readonly qwenAdapter: QwenAdapter,
  ) {
    // 注册所有适配器
    this.adapters = new Map<string, BaseCapabilityAdapter>([
      ['openai', this.openaiAdapter],
      ['deepseek', this.deepseekAdapter],
      ['qwen', this.qwenAdapter],
      // 后续可以添加更多适配器
      // ['anthropic', this.anthropicAdapter],
      // ['google', this.googleAdapter],
    ]);
  }

  /**
   * 根据提供商名称获取适配器
   */
  getAdapter(provider: string): BaseCapabilityAdapter {
    const adapter = this.adapters.get(provider.toLowerCase());

    if (!adapter) {
      throw new Error(
        `Unsupported provider: ${provider}. Available providers: ${Array.from(
          this.adapters.keys(),
        ).join(', ')}`,
      );
    }

    return adapter;
  }

  /**
   * 获取所有支持的提供商列表
   */
  getSupportedProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 检查提供商是否支持
   */
  isProviderSupported(provider: string): boolean {
    return this.adapters.has(provider.toLowerCase());
  }
}
