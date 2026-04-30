/**
 * DeepSeek AI 客户端 + AI 结果验证清理
 *
 * 拆分自 food-enrichment.service.ts（步骤 3）。
 * 职责：
 *  - 持有 axios 实例、apiKey、maxRetries
 *  - callAIRaw: 原始 chat/completions 请求 + JSON 解析
 *  - callAI: callAIRaw + validateAndClean
 *  - validateAndClean: AI 返回值类型校验、范围校验、字段清理
 *  - sleep / exponentialBackoff: 重试辅助
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ENRICHABLE_STRING_FIELDS,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  snakeToCamel,
} from '../constants/enrichable-fields';
import { NUTRIENT_RANGES } from '../constants/nutrient-ranges';
import type { EnrichmentResult } from '../constants/enrichment.types';
import type { EnrichmentTarget } from '../constants/enrichable-fields';
import type { EnrichmentStage } from '../constants/enrichment-stages';
import { ALL_COOKING_METHODS } from '../../../../modules/food/cooking-method.constants';

@Injectable()
export class EnrichmentAiClient {
  readonly logger = new Logger(EnrichmentAiClient.name);
  readonly client: AxiosInstance;
  readonly maxRetries = 3;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') ?? '';
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ─── 原始 AI 请求 ─────────────────────────────────────────────────────

  async callAIRaw(
    foodName: string,
    prompt: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
    },
  ): Promise<Record<string, any> | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                options?.systemPrompt ??
                '你是权威食品营养数据库专家。根据食物名称和已有数据，推算缺失字段。严格按JSON格式返回，数值基于每100g计算，禁止自由文本。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: options?.maxTokens ?? 1200,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        return JSON.parse(content) as Record<string, any>;
      } catch (e) {
        this.logger.warn(
          `Attempt ${attempt} failed for "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries)
          await this.sleep(this.exponentialBackoff(attempt));
      }
    }

    this.logger.error(`All AI attempts failed for "${foodName}"`);
    return null;
  }

  // ─── 阶段专用 AI 请求（使用阶段 systemPrompt 和 maxTokens）──────────

  async callAIForStage(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    stage: EnrichmentStage,
    buildStageSystemPrompt: (stage: EnrichmentStage) => string,
  ): Promise<EnrichmentResult | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildStageSystemPrompt(stage) },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: stage.maxTokens,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const raw = JSON.parse(content) as Record<string, any>;
        const validated = this.validateAndClean(raw, requestedFields, 'foods');
        if (validated) return validated;

        this.logger.warn(
          `[阶段${stage.stage}] 第${attempt}次验证失败: "${foodName}"`,
        );
      } catch (e) {
        this.logger.warn(
          `[阶段${stage.stage}] 第${attempt}次调用失败: "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries)
          await this.sleep(this.exponentialBackoff(attempt));
      }
    }

    this.logger.error(`[阶段${stage.stage}] AI 全部失败: "${foodName}"`);
    return null;
  }

  // ─── 通用 AI 请求（callAIRaw + validateAndClean）─────────────────────

  async callAI(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): Promise<EnrichmentResult | null> {
    const raw = await this.callAIRaw(foodName, prompt);
    if (!raw) return null;

    const validated = this.validateAndClean(raw, requestedFields, target);
    if (validated) return validated;

    this.logger.error(`All AI attempts failed for "${foodName}"`);
    return null;
  }

  // ─── AI 结果验证与清理 ────────────────────────────────────────────────

  validateAndClean(
    raw: Record<string, any>,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): EnrichmentResult | null {
    if (!raw || typeof raw !== 'object') return null;

    const result: EnrichmentResult = {
      confidence:
        typeof raw.confidence === 'number'
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    };

    // V8.4: 提取字段级置信度
    // Prompt 要求 AI 返回 "field_confidence"（snake_case），但早期代码用 camelCase 解析
    // 两种 key 都兼容，优先取 snake_case（Prompt 规范），回退 camelCase
    const rawFieldConf =
      (raw.field_confidence &&
      typeof raw.field_confidence === 'object' &&
      !Array.isArray(raw.field_confidence)
        ? raw.field_confidence
        : null) ??
      (raw.fieldConfidence &&
      typeof raw.fieldConfidence === 'object' &&
      !Array.isArray(raw.fieldConfidence)
        ? raw.fieldConfidence
        : null);

    if (rawFieldConf) {
      const parsedFieldConf: Record<string, number> = {};
      for (const field of requestedFields) {
        // requestedFields 是 snake_case；AI 可能用 snake_case 或 camelCase 返回
        const val = rawFieldConf[field] ?? rawFieldConf[snakeToCamel(field)];
        if (typeof val === 'number' && val >= 0 && val <= 1) {
          parsedFieldConf[field] = Math.round(val * 100) / 100;
        }
      }
      if (Object.keys(parsedFieldConf).length > 0) {
        result.fieldConfidence = parsedFieldConf;
      }
    }

    const stringFields = [
      ...(ENRICHABLE_STRING_FIELDS as unknown as string[]),
      // translation fields
      'name',
      'aliases',
      'description',
      'availability',
      'currency_code',
      'price_unit',
      'source',
      'source_url',
    ];
    const jsonObjectFields = [
      ...(JSON_OBJECT_FIELDS as unknown as string[]),
      'regulatory_info',
    ];

    for (const field of requestedFields) {
      const value = raw[field];
      if (value === null || value === undefined) {
        result[field] = null;
        continue;
      }

      if (field === 'month_weights') {
        result[field] =
          Array.isArray(value) &&
          value.length === 12 &&
          value.every((item) => {
            const num = Number(item);
            return !Number.isNaN(num) && num >= 0 && num <= 1;
          })
            ? value.map((item) => Math.round(Number(item) * 100) / 100)
            : null;
        continue;
      }

      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field)) {
        if (!Array.isArray(value)) {
          result[field] = null;
          continue;
        }
        // V8.5: validate cooking_methods values against the standard code set
        if (field === 'cooking_methods') {
          const validSet = new Set<string>(
            ALL_COOKING_METHODS as readonly string[],
          );
          const filtered = value.filter(
            (v: any) => typeof v === 'string' && validSet.has(v),
          );
          if (filtered.length === 0 && value.length > 0) {
            this.logger.warn(
              `"cooking_methods" AI returned non-standard values: [${value.join(', ')}], discarding`,
            );
          }
          result[field] = filtered.length > 0 ? filtered : null;
          continue;
        }
        result[field] = value;
        continue;
      }

      if (jsonObjectFields.includes(field)) {
        result[field] =
          typeof value === 'object' && !Array.isArray(value) ? value : null;
        continue;
      }

      if (stringFields.includes(field)) {
        result[field] =
          typeof value === 'string' && value.trim() ? value.trim() : null;
        continue;
      }

      // 数值
      const numValue =
        typeof value === 'string' ? parseFloat(value) : Number(value);
      if (isNaN(numValue)) {
        result[field] = null;
        continue;
      }

      // V8.4: NUTRIENT_RANGES key 是 camelCase，requestedFields 是 snake_case
      // 同时尝试 snake_case 和 camelCase 两种 key，避免范围校验全部失效
      const range =
        NUTRIENT_RANGES[field] ?? NUTRIENT_RANGES[snakeToCamel(field)];
      if (range && (numValue < range.min || numValue > range.max)) {
        this.logger.warn(
          `"${field}" value ${numValue} out of range [${range.min},${range.max}]`,
        );
        result[field] = null;
        continue;
      }

      result[field] = numValue;
    }

    return result;
  }

  // ─── 重试辅助 ─────────────────────────────────────────────────────────

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 指数退避 + 随机抖动
   * attempt 1 → ~2s, attempt 2 → ~4s, attempt 3 → ~8s，上限 15s
   */
  exponentialBackoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
  }
}
