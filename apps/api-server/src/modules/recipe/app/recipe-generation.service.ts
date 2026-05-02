import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
} from '../../../core/queue/queue.constants';
import { RecipeManagementService } from '../admin/recipe-management.service';
import { CreateRecipeDto } from '../admin/dto/recipe-management.dto';
import { LlmService } from '../../../core/llm/llm.service';
import {
  LlmFeature,
  LlmQuotaExceededError,
  LlmUnavailableError,
} from '../../../core/llm/llm.types';

// ==================== Types ====================

/** 菜谱生成请求参数 */
export interface RecipeGenerationRequest {
  /** 菜系 */
  cuisine: string;
  /** 目标类型: fat_loss / muscle_gain / health */
  goalType: string;
  /** 生成数量 */
  count: number;
  /** 难度范围 */
  maxDifficulty?: number;
  /** 最大烹饪时间（分钟） */
  maxCookTime?: number;
  /** 额外约束（如低钠、高纤维） */
  constraints?: string[];
  /** 指定模型（管理端覆盖用） */
  modelOverride?: string;
}

// ==================== 模型路由 ====================

/** 模型能力层级 */
type ModelTier = 'fast' | 'standard' | 'strong';

/** 模型路由配置 */
interface ModelRouteConfig {
  /** 模型 ID */
  modelId: string;
  /** 最大 token */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 超时(ms) */
  timeoutMs: number;
}

/**
 * 默认模型路由表
 *
 * - fast:     简单菜谱（难度 ≤2、无额外约束），追求速度和成本
 * - standard: 普通菜谱（默认），平衡质量与成本
 * - strong:   复杂菜谱（难度 ≥4、多约束、融合菜系等），追求最佳输出质量
 */
const DEFAULT_MODEL_ROUTES: Record<ModelTier, ModelRouteConfig> = {
  fast: {
    modelId: 'baidu/ernie-4.5-8k',
    maxTokens: 3000,
    temperature: 0.6,
    timeoutMs: 45_000,
  },
  standard: {
    modelId: 'baidu/ernie-4.5-8k',
    maxTokens: 4000,
    temperature: 0.7,
    timeoutMs: 60_000,
  },
  strong: {
    modelId: 'deepseek/deepseek-chat-v3-0324',
    maxTokens: 6000,
    temperature: 0.75,
    timeoutMs: 90_000,
  },
};

/** 被视为"复杂菜系"的关键词（融合/分子/宫廷/法餐等） */
const COMPLEX_CUISINES = new Set([
  '融合',
  '分子料理',
  '法餐',
  '法式',
  '宫廷',
  '怀石',
  '西班牙',
  'fusion',
  'molecular',
]);

/** 队列 Job 数据 */
export interface RecipeGenerationJobData {
  request: RecipeGenerationRequest;
  requestId: string;
  batchIndex: number;
  batchSize: number;
}

// ==================== LLM Prompt ====================

const RECIPE_GENERATION_SYSTEM_PROMPT = `你是专业的中式/西式菜谱创作营养师。根据用户要求，生成健康菜谱。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "recipes": [
    {
      "name": "菜谱名称",
      "description": "一句话描述（不超过100字）",
      "cuisine": "菜系（如：中餐/粤菜/川菜/日式/西式/东南亚）",
      "difficulty": 1-5（难度等级）,
      "prepTimeMinutes": 准备时间（分钟，数字）,
      "cookTimeMinutes": 烹饪时间（分钟，数字）,
      "servings": 份数（数字）,
      "tags": ["标签1", "标签2"],
      "instructions": [
        { "step": 1, "text": "步骤描述" }
      ],
      "caloriesPerServing": 每份卡路里（数字）,
      "proteinPerServing": 每份蛋白质（克，数字）,
      "fatPerServing": 每份脂肪（克，数字）,
      "carbsPerServing": 每份碳水（克，数字）,
      "fiberPerServing": 每份纤维（克，数字）,
      "ingredients": [
        {
          "ingredientName": "食材名称",
          "amount": 用量（数字），
          "unit": "单位（克/毫升/个/勺等）",
          "isOptional": false
        }
      ]
    }
  ]
}

规则：
- 营养数据必须合理：卡路里 = 蛋白质×4 + 碳水×4 + 脂肪×9（允许±10%误差）
- 每道菜的食材列表要完整，包含调味料
- 步骤要清晰可操作
- 标签应包含：目标类型（如减脂/增肌）、烹饪方式（如蒸/炒/煮）、特点（如快手/低卡）
- 菜谱名称不要重复
- 份数默认为 1-2 人份`;

/**
 * V6.3 P2-7: AI 菜谱批量生成服务
 *
 * 支持:
 * - 同步生成少量菜谱（≤3）
 * - 异步队列批量生成（>3）
 */
@Injectable()
export class RecipeGenerationService {
  private readonly logger = new Logger(RecipeGenerationService.name);
  private readonly apiKey: string;
  /** 默认模型（向后兼容，作为 standard tier 的覆盖） */
  private readonly defaultModel: string;
  /** 模型路由表（可通过环境变量覆盖） */
  private readonly modelRoutes: Record<ModelTier, ModelRouteConfig>;

  constructor(
    private readonly configService: ConfigService,
    private readonly recipeManagementService: RecipeManagementService,
    @InjectQueue(QUEUE_NAMES.RECIPE_GENERATION)
    private readonly generationQueue: Queue,
    private readonly llm: LlmService,
  ) {
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';
    this.defaultModel =
      this.configService.get<string>('RECIPE_GENERATION_MODEL') ||
      this.configService.get<string>('TEXT_ANALYSIS_MODEL') ||
      'baidu/ernie-4.5-8k';

    // 构建模型路由表，支持环境变量覆盖各层级模型
    this.modelRoutes = { ...DEFAULT_MODEL_ROUTES };
    const fastModel = this.configService.get<string>('RECIPE_MODEL_FAST');
    const standardModel = this.configService.get<string>(
      'RECIPE_MODEL_STANDARD',
    );
    const strongModel = this.configService.get<string>('RECIPE_MODEL_STRONG');
    if (fastModel)
      this.modelRoutes.fast = { ...this.modelRoutes.fast, modelId: fastModel };
    if (standardModel)
      this.modelRoutes.standard = {
        ...this.modelRoutes.standard,
        modelId: standardModel,
      };
    if (strongModel)
      this.modelRoutes.strong = {
        ...this.modelRoutes.strong,
        modelId: strongModel,
      };

    // 默认模型覆盖 standard tier（向后兼容 RECIPE_GENERATION_MODEL）
    if (this.defaultModel !== 'baidu/ernie-4.5-8k') {
      this.modelRoutes.standard = {
        ...this.modelRoutes.standard,
        modelId: this.defaultModel,
      };
    }

    this.logger.log(
      `模型路由初始化: fast=${this.modelRoutes.fast.modelId}, ` +
        `standard=${this.modelRoutes.standard.modelId}, ` +
        `strong=${this.modelRoutes.strong.modelId}`,
    );
  }

  // ==================== 公开 API ====================

  /**
   * 生成菜谱（自动选择同步/异步）
   *
   * count ≤ 3: 同步生成并入库，立即返回结果
   * count > 3: 拆分为每批3个，入队列异步处理，返回 jobIds
   */
  async generate(request: RecipeGenerationRequest): Promise<{
    mode: 'sync' | 'async';
    created?: number;
    errors?: string[];
    jobIds?: string[];
  }> {
    if (request.count <= 3) {
      return this.generateSync(request);
    }
    return this.generateAsync(request);
  }

  /**
   * 同步生成（≤3道）
   */
  async generateSync(
    request: RecipeGenerationRequest,
  ): Promise<{ mode: 'sync'; created: number; errors: string[] }> {
    const rawRecipes = await this.callLLM(request);
    const result = await this.recipeManagementService.createBatch(rawRecipes);
    return { mode: 'sync', ...result };
  }

  /**
   * 异步生成（>3道，拆分批次入队列）
   */
  async generateAsync(
    request: RecipeGenerationRequest,
  ): Promise<{ mode: 'async'; jobIds: string[] }> {
    const batchSize = 3;
    const totalBatches = Math.ceil(request.count / batchSize);
    const requestId = `recipe_gen_${Date.now()}`;
    const jobIds: string[] = [];

    for (let i = 0; i < totalBatches; i++) {
      const batchCount = Math.min(batchSize, request.count - i * batchSize);
      const batchRequest: RecipeGenerationRequest = {
        ...request,
        count: batchCount,
      };

      const opts = QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.RECIPE_GENERATION];
      const job = await this.generationQueue.add(
        'generate-batch',
        {
          request: batchRequest,
          requestId,
          batchIndex: i,
          batchSize: totalBatches,
        } as RecipeGenerationJobData,
        {
          attempts: opts.maxRetries,
          backoff: { type: opts.backoffType, delay: opts.backoffDelay },
          removeOnComplete: 200,
          removeOnFail: 100,
        },
      );

      if (job.id) {
        jobIds.push(job.id);
      }
    }

    this.logger.log(
      `菜谱批量生成已入队: ${totalBatches} 批次, requestId=${requestId}`,
    );
    return { mode: 'async', jobIds };
  }

  // ==================== LLM 调用 ====================

  /**
   * 调用 LLM 生成菜谱，返回 CreateRecipeDto[]
   * 根据请求复杂度自动选择模型层级
   */
  async callLLM(request: RecipeGenerationRequest): Promise<CreateRecipeDto[]> {
    if (!this.apiKey) {
      this.logger.warn('AI API Key 未配置，无法生成菜谱');
      return [];
    }

    // 模型路由：确定层级 → 获取配置
    const tier = request.modelOverride
      ? 'standard'
      : this.determineModelTier(request);
    const routeConfig = this.modelRoutes[tier];
    const modelId = request.modelOverride || routeConfig.modelId;

    this.logger.log(
      `模型路由决策: tier=${tier}, model=${modelId}, ` +
        `cuisine=${request.cuisine}, difficulty=${request.maxDifficulty ?? 'any'}, ` +
        `constraints=${request.constraints?.length ?? 0}`,
    );

    const userPrompt = this.buildUserPrompt(request);

    try {
      const result = await this.llm.chat({
        feature: LlmFeature.RecipeGeneration,
        // 后台批量生成，无 userId（管理员触发）
        provider: 'openrouter',
        apiKey: this.apiKey,
        baseUrl:
          this.configService.get<string>('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1',
        model: modelId,
        temperature: routeConfig.temperature,
        maxTokens: routeConfig.maxTokens,
        timeoutMs: routeConfig.timeoutMs,
        messages: [
          { role: 'system', content: RECIPE_GENERATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      if (!result.content) {
        this.logger.warn('LLM 返回空内容');
        return [];
      }

      return this.parseLLMResponse(result.content, request);
    } catch (err: any) {
      if (err instanceof LlmQuotaExceededError) {
        // 后台任务不应被配额限制（feature 配额=0），但保险起见上抛
        throw err;
      }
      if (err instanceof LlmUnavailableError) {
        this.logger.error(`LLM 服务不可用: ${err.message}, model=${modelId}`);
        return [];
      }
      this.logger.error(`LLM 调用异常: ${err.message}, model=${modelId}`);
      return [];
    }
  }

  // ==================== 模型路由逻辑 ====================

  /**
   * 根据请求参数确定模型层级
   *
   * 判定规则（优先级从高到低）：
   * 1. strong: 难度 ≥4, 或 约束 ≥3, 或 复杂菜系
   * 2. fast:   难度 ≤2 且 无约束 且 普通菜系 且 数量 ≤2
   * 3. standard: 其余所有情况
   */
  private determineModelTier(request: RecipeGenerationRequest): ModelTier {
    const difficulty = request.maxDifficulty ?? 3;
    const constraintCount = request.constraints?.length ?? 0;
    const isComplexCuisine = COMPLEX_CUISINES.has(request.cuisine);

    // strong 条件
    if (difficulty >= 4 || constraintCount >= 3 || isComplexCuisine) {
      return 'strong';
    }

    // fast 条件
    if (difficulty <= 2 && constraintCount === 0 && request.count <= 2) {
      return 'fast';
    }

    return 'standard';
  }

  // ==================== 内部方法 ====================

  private buildUserPrompt(request: RecipeGenerationRequest): string {
    const parts: string[] = [];
    parts.push(`请生成 ${request.count} 道菜谱。`);
    parts.push(`菜系: ${request.cuisine}`);

    // 目标类型决定营养侧重
    const goalDescriptions: Record<string, string> = {
      fat_loss:
        '减脂目标：低卡路里（单份 300-500kcal），高蛋白（≥25g），低脂（≤15g），高纤维（≥5g）',
      muscle_gain:
        '增肌目标：高蛋白（单份 ≥35g），适量碳水（≥40g），中等卡路里（400-700kcal）',
      health: '均衡健康：卡路里适中（350-600kcal），营养均衡，蔬菜丰富',
    };
    parts.push(
      goalDescriptions[request.goalType] || goalDescriptions['health'],
    );

    if (request.maxDifficulty) {
      parts.push(`难度不超过 ${request.maxDifficulty} 级（1-5）`);
    }
    if (request.maxCookTime) {
      parts.push(`烹饪时间不超过 ${request.maxCookTime} 分钟`);
    }
    if (request.constraints && request.constraints.length > 0) {
      parts.push(`额外约束: ${request.constraints.join('、')}`);
    }

    return parts.join('\n');
  }

  private parseLLMResponse(
    content: string,
    request: RecipeGenerationRequest,
  ): CreateRecipeDto[] {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn('LLM 返回内容无法解析为 JSON');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const rawRecipes = parsed.recipes || parsed.data || [];

      if (!Array.isArray(rawRecipes) || rawRecipes.length === 0) {
        this.logger.warn('LLM 返回的菜谱数组为空');
        return [];
      }

      return rawRecipes.map(
        (r: any): CreateRecipeDto => ({
          name: String(r.name || '未命名菜谱'),
          description: r.description || null,
          cuisine: r.cuisine || request.cuisine,
          difficulty: Math.min(5, Math.max(1, Number(r.difficulty) || 1)),
          prepTimeMinutes: r.prepTimeMinutes
            ? Number(r.prepTimeMinutes)
            : undefined,
          cookTimeMinutes: r.cookTimeMinutes
            ? Number(r.cookTimeMinutes)
            : undefined,
          servings: r.servings ? Number(r.servings) : 1,
          tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
          instructions: r.instructions || null,
          source: 'ai_generated',
          caloriesPerServing: r.caloriesPerServing
            ? Number(r.caloriesPerServing)
            : undefined,
          proteinPerServing: r.proteinPerServing
            ? Number(r.proteinPerServing)
            : undefined,
          fatPerServing: r.fatPerServing ? Number(r.fatPerServing) : undefined,
          carbsPerServing: r.carbsPerServing
            ? Number(r.carbsPerServing)
            : undefined,
          fiberPerServing: r.fiberPerServing
            ? Number(r.fiberPerServing)
            : undefined,
          ingredients: Array.isArray(r.ingredients)
            ? r.ingredients.map((ing: any, idx: number) => ({
                ingredientName: String(
                  ing.ingredientName || ing.name || '未知食材',
                ),
                amount: ing.amount ? Number(ing.amount) : undefined,
                unit: ing.unit || undefined,
                isOptional: ing.isOptional ?? false,
                sortOrder: idx,
              }))
            : [],
        }),
      );
    } catch (err: any) {
      this.logger.error(`菜谱 LLM 响应解析失败: ${err.message}`);
      return [];
    }
  }
}
