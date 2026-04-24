import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';

/**
 * 置信度驱动的饮食图片分析 V1
 * Session 生命周期管理服务
 *
 * 关联设计文档：docs/CONFIDENCE_DRIVEN_FOOD_ANALYSIS_V1.md §2.3, §3.2
 *
 * 职责：
 * - 在用户发起图片分析时创建 session（绑定 requestId + userId + 配额记录）
 * - 在 Vision 判定后更新 session 状态（awaiting_refine / finalized）
 * - refine 时校验 session 归属/状态/未过期，并跳过配额扣减
 * - 封装 Redis 存取（与 analyze.service 的分析缓存隔离 namespace）
 */
export type AnalysisSessionStatus =
  | 'pending'
  | 'awaiting_refine'
  | 'finalized'
  | 'abandoned';

export type AnalysisConfidenceLevel = 'high' | 'low';

export interface AnalyzedFoodItemLite {
  id: string;
  name: string;
  quantity: string;
  estimatedWeightGrams: number | null;
  confidence: number;
  uncertaintyHints?: string[];
}

export interface RefinedFoodInput {
  name: string;
  /** v1.1：必填，只用克数，不再接受 quantity 字符串 */
  estimatedWeightGrams: number;
  originalId?: string;
}

export interface AnalysisSession {
  id: string;
  userId: string;
  requestId: string;
  mealType?: string;
  status: AnalysisSessionStatus;
  createdAt: string;
  expiresAt: string;
  /** 首次图片分析已扣配额标识（供审计 / refine 跳过） */
  quotaConsumed: {
    feature: 'AI_IMAGE_ANALYSIS';
    consumedAt: string;
  };
  imagePhase?: {
    overallConfidence: number;
    confidenceLevel: AnalysisConfidenceLevel;
    rawFoods: AnalyzedFoodItemLite[];
    reasons: string[];
    imageUrl: string;
  };
  refinePhase?: {
    submittedAt: string;
    refinedFoods: RefinedFoodInput[];
    derivedText: string;
  };
  finalResultKey?: string;
}

const SESSION_NAMESPACE = 'analysis_session';
const DEFAULT_SESSION_TTL_SECONDS = 30 * 60;

@Injectable()
export class AnalysisSessionService {
  private readonly logger = new Logger(AnalysisSessionService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisCacheService,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = Number(
      this.config.get('ANALYSIS_SESSION_TTL_SECONDS') ??
        DEFAULT_SESSION_TTL_SECONDS,
    );
  }

  /** 创建 session；在 Controller 层扣配额成功后、submitAnalysis 前调用 */
  async createSession(params: {
    userId: string;
    requestId: string;
    mealType?: string;
    imageUrl: string;
  }): Promise<AnalysisSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const session: AnalysisSession = {
      id: randomUUID(),
      userId: params.userId,
      requestId: params.requestId,
      mealType: params.mealType,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      quotaConsumed: {
        feature: 'AI_IMAGE_ANALYSIS',
        consumedAt: now.toISOString(),
      },
      imagePhase: {
        overallConfidence: 0,
        confidenceLevel: 'low',
        rawFoods: [],
        reasons: [],
        imageUrl: params.imageUrl,
      },
    };

    await this.persist(session);
    // 索引：requestId -> sessionId（Controller 收到 requestId 时反查 session）
    await this.redis.set(
      this.indexKey(params.requestId),
      session.id,
      this.ttlSeconds * 1000,
    );
    this.logger.log(
      `analysis session created: id=${session.id}, requestId=${params.requestId}, userId=${params.userId}`,
    );
    return session;
  }

  /** 通过 requestId 反查 session（Controller 分支渲染时用） */
  async getByRequestId(requestId: string): Promise<AnalysisSession | null> {
    const sessionId = await this.redis.get<string>(this.indexKey(requestId));
    if (!sessionId) return null;
    return this.getById(sessionId);
  }

  async getById(id: string): Promise<AnalysisSession | null> {
    return this.redis.get<AnalysisSession>(this.sessionKey(id));
  }

  /** 标记低置信度，等待 refine */
  async markAwaitingRefine(
    id: string,
    imagePhase: NonNullable<AnalysisSession['imagePhase']>,
  ): Promise<AnalysisSession | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const next: AnalysisSession = {
      ...current,
      status: 'awaiting_refine',
      imagePhase,
    };
    await this.persist(next);
    return next;
  }

  /** 标记已出最终结果（高置信度直出 或 refine 之后） */
  async markFinalized(
    id: string,
    patch?: Partial<
      Pick<AnalysisSession, 'finalResultKey' | 'refinePhase' | 'imagePhase'>
    >,
  ): Promise<AnalysisSession | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const next: AnalysisSession = {
      ...current,
      status: 'finalized',
      ...(patch ?? {}),
    };
    await this.persist(next);
    return next;
  }

  /**
   * Refine 前置校验：归属 + 状态 + 未过期。
   * 校验失败时抛标准 Error（Controller 层转换为 HTTP 错误）。
   */
  async assertRefineable(
    id: string,
    userId: string,
  ): Promise<AnalysisSession> {
    const session = await this.getById(id);
    if (!session) {
      throw Object.assign(new Error('SESSION_NOT_FOUND'), {
        code: 'SESSION_NOT_FOUND',
      });
    }
    if (session.userId !== userId) {
      throw Object.assign(new Error('SESSION_FORBIDDEN'), {
        code: 'SESSION_FORBIDDEN',
      });
    }
    if (Date.parse(session.expiresAt) < Date.now()) {
      throw Object.assign(new Error('SESSION_EXPIRED'), {
        code: 'SESSION_EXPIRED',
      });
    }
    if (session.status !== 'awaiting_refine') {
      throw Object.assign(new Error('SESSION_WRONG_STATUS'), {
        code: 'SESSION_WRONG_STATUS',
        meta: { status: session.status },
      });
    }
    return session;
  }

  /**
   * 将 refinedFoods 拼成给 TextFoodAnalysisService 的描述文本。
   * 规则：**只用克数**，格式为 "{name} {grams}克"。
   * estimatedWeightGrams 为必填（前端强制）；若缺失则抛出错误，
   * 而不是降级到 quantity 字符串（防止 AI 对非结构化份量描述产生幻觉）。
   */
  buildDerivedText(foods: RefinedFoodInput[], userNote?: string): string {
    const parts = foods.map((f) => {
      const name = (f.name || '').trim();
      if (!name) return '';
      const grams =
        typeof f.estimatedWeightGrams === 'number' && f.estimatedWeightGrams > 0
          ? Math.round(f.estimatedWeightGrams)
          : null;
      if (!grams) {
        throw new Error(`食物「${name}」未填写克数，请填写后重试`);
      }
      return `${name} ${grams}克`;
    }).filter(Boolean);

    const base = parts.join('、');
    const note = userNote?.trim();
    return note ? `${base}。${note}` : base;
  }

  private async persist(session: AnalysisSession): Promise<void> {
    // TTL 以 expiresAt 为准，避免延长
    const remainMs = Math.max(
      1000,
      Date.parse(session.expiresAt) - Date.now(),
    );
    await this.redis.set(this.sessionKey(session.id), session, remainMs);
  }

  private sessionKey(id: string): string {
    return this.redis.buildKey(SESSION_NAMESPACE, id);
  }

  private indexKey(requestId: string): string {
    return this.redis.buildKey(SESSION_NAMESPACE, 'by-request', requestId);
  }
}
