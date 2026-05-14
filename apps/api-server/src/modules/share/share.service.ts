import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisCacheService } from '../../core/redis/redis-cache.service';
import { CreateShareDto } from './dto/create-share.dto';
import {
  PublicShareResponse,
  ShareSnapshot,
  ShareType,
  ShareVisibility,
} from './share.types';

type FoodAnalysisRow = {
  id: string;
  user_id: string;
  input_type: string;
  raw_text: string | null;
  image_url: string | null;
  meal_type: string | null;
  recognized_payload: Prisma.JsonValue | null;
  nutrition_payload: Prisma.JsonValue | null;
  decision_payload: Prisma.JsonValue | null;
  confidence_score: Prisma.Decimal | null;
  quality_score: Prisma.Decimal | null;
  created_at: Date | null;
};

type FoodRecordRow = {
  id: string;
  user_id: string;
  image_url: string | null;
  foods: Prisma.JsonValue;
  total_calories: number;
  advice: string | null;
  decision: string;
  risk_level: string | null;
  reason: string | null;
  suggestion: string | null;
  total_protein: Prisma.Decimal;
  total_fat: Prisma.Decimal;
  total_carbs: Prisma.Decimal;
  nutrition_score: number;
  recorded_at: Date;
  created_at: Date;
};

type GrowthShareRow = {
  id: string;
  token: string;
  share_type: ShareType;
  source_type: 'analysis' | 'record' | 'custom';
  visibility: ShareVisibility;
  snapshot: Prisma.JsonValue;
  locale: string | null;
  title: string | null;
  description: string | null;
  status: string;
  expires_at: Date | null;
  created_at: Date;
};

@Injectable()
export class ShareService {
  private readonly appUrl: string;
  private readonly appStoreUrl: string;
  private readonly googlePlayUrl?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly config: ConfigService,
  ) {
    this.appUrl = this.config.get<string>('APP_PUBLIC_URL') || 'https://eatcheck.app';
    this.appStoreUrl =
      this.config.get<string>('IOS_APP_STORE_URL') ||
      'https://apps.apple.com/us/app/eatcheck/id6763199295';
    this.googlePlayUrl = this.config.get<string>('ANDROID_GOOGLE_PLAY_URL');
  }

  async createForUser(
    userId: string,
    dto: CreateShareDto,
  ): Promise<PublicShareResponse & { url: string; ogImageUrl: string }> {
    if (dto.sourceType === 'custom') {
      throw new BadRequestException('Custom shares require an explicit snapshot producer');
    }
    if (!dto.sourceId) {
      throw new BadRequestException('sourceId is required');
    }

    const snapshot =
      dto.sourceType === 'analysis'
        ? await this.buildAnalysisSnapshot(userId, dto.sourceId, dto.shareType, dto.locale)
        : await this.buildRecordSnapshot(userId, dto.sourceId, dto.shareType, dto.locale);

    const token = await this.generateUniqueToken();
    const visibility = dto.visibility ?? 'unlisted';

    const snapshotJson = JSON.stringify(snapshot);

    const rows = await this.prisma.$queryRaw<GrowthShareRow[]>`
      INSERT INTO growth_shares (
        token,
        user_id,
        share_type,
        source_type,
        source_id,
        visibility,
        snapshot,
        locale,
        title,
        description
      ) VALUES (
        ${token},
        ${userId}::uuid,
        ${dto.shareType},
        ${dto.sourceType},
        ${dto.sourceId}::uuid,
        ${visibility},
        ${snapshotJson}::jsonb,
        ${dto.locale ?? null},
        ${snapshot.seo.title},
        ${snapshot.seo.description}
      )
      RETURNING id, token, share_type, source_type, visibility, snapshot, locale, title, description, status, expires_at, created_at
    `;

    const share = this.mapPublicShare(rows[0]);
    await this.cacheShare(share);

    return {
      ...share,
      url: `${this.appUrl}/share/${token}`,
      ogImageUrl: `${this.appUrl}/api/og/share/${token}`,
    };
  }

  async getPublicShare(token: string): Promise<PublicShareResponse> {
    const cacheKey = this.redis.buildKey('growth_share', token);
    const cached = await this.redis.get<PublicShareResponse>(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.$queryRaw<GrowthShareRow[]>`
      SELECT id, token, share_type, source_type, visibility, snapshot, locale, title, description, status, expires_at, created_at
      FROM growth_shares
      WHERE token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new NotFoundException('Share not found');
    }

    const row = rows[0];
    if (row.status !== 'active') {
      throw new NotFoundException('Share is not active');
    }
    if (row.expires_at && row.expires_at.getTime() < Date.now()) {
      throw new NotFoundException('Share expired');
    }

    const share = this.mapPublicShare(row);
    await this.cacheShare(share);
    return share;
  }

  async trackView(token: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE growth_shares
      SET view_count = view_count + 1, updated_at = now()
      WHERE token = ${token} AND status = 'active'
    `;
  }

  async trackCta(token: string): Promise<{ redirectUrl: string }> {
    await this.prisma.$executeRaw`
      UPDATE growth_shares
      SET click_count = click_count + 1, updated_at = now()
      WHERE token = ${token} AND status = 'active'
    `;
    return { redirectUrl: this.appStoreUrl };
  }

  private async buildAnalysisSnapshot(
    userId: string,
    analysisId: string,
    shareType: ShareType,
    locale?: string,
  ): Promise<ShareSnapshot> {
    const rows = await this.prisma.$queryRaw<FoodAnalysisRow[]>`
      SELECT
        id,
        user_id,
        input_type,
        raw_text,
        image_url,
        meal_type,
        recognized_payload,
        nutrition_payload,
        decision_payload,
        confidence_score,
        quality_score,
        created_at
      FROM food_analysis_records
      WHERE id = ${analysisId}::uuid
      LIMIT 1
    `;
    const record = rows[0];
    if (!record) throw new NotFoundException('Analysis not found');
    if (record.user_id !== userId) throw new ForbiddenException('No access to analysis');

    const nutrition = this.asObject(record.nutrition_payload);
    const recognized = this.asObject(record.recognized_payload);
    const decisionPayload = this.asObject(record.decision_payload);
    const totals = this.asObject(nutrition.totals);
    const score = this.asObject(nutrition.score);
    const decision = this.asObject(decisionPayload.decision);
    const explanation = this.asObject(decisionPayload.explanation);
    const foods = this.extractFoods(recognized.foods ?? nutrition.foods);
    const title = this.buildTitle(shareType, foods, this.num(score.nutritionScore));
    const summary =
      this.str(explanation.summary) ||
      this.str(decision.reason) ||
      'AI analyzed this meal and found a few practical nutrition signals.';

    return this.buildSnapshot({
      shareType,
      sourceType: 'analysis',
      sourceId: analysisId,
      title,
      summary,
      score: this.num(score.nutritionScore) || this.num(score.healthScore),
      imageUrl: record.image_url ?? undefined,
      foods,
      totals,
      decision: this.str(decision.recommendation) || this.str(decision.riskLevel),
      locale,
      createdAt: record.created_at ?? new Date(),
    });
  }

  private async buildRecordSnapshot(
    userId: string,
    recordId: string,
    shareType: ShareType,
    locale?: string,
  ): Promise<ShareSnapshot> {
    const rows = await this.prisma.$queryRaw<FoodRecordRow[]>`
      SELECT
        id,
        user_id,
        image_url,
        foods,
        total_calories,
        advice,
        decision,
        risk_level,
        reason,
        suggestion,
        total_protein,
        total_fat,
        total_carbs,
        nutrition_score,
        recorded_at,
        created_at
      FROM food_records
      WHERE id = ${recordId}::uuid
      LIMIT 1
    `;
    const record = rows[0];
    if (!record) throw new NotFoundException('Food record not found');
    if (record.user_id !== userId) throw new ForbiddenException('No access to record');

    const foods = this.extractFoods(record.foods);
    const title = this.buildTitle(shareType, foods, record.nutrition_score);
    const summary =
      record.advice ||
      record.reason ||
      record.suggestion ||
      'AI analyzed this meal and summarized the key nutrition signals.';

    return this.buildSnapshot({
      shareType,
      sourceType: 'record',
      sourceId: recordId,
      title,
      summary,
      score: record.nutrition_score,
      imageUrl: record.image_url ?? undefined,
      foods,
      totals: {
        calories: record.total_calories,
        protein: Number(record.total_protein),
        fat: Number(record.total_fat),
        carbs: Number(record.total_carbs),
      },
      decision: record.decision,
      locale,
      createdAt: record.recorded_at ?? record.created_at,
    });
  }

  private buildSnapshot(input: {
    shareType: ShareType;
    sourceType: 'analysis' | 'record';
    sourceId: string;
    title: string;
    summary: string;
    score?: number;
    imageUrl?: string;
    foods: ShareSnapshot['foods'];
    totals: Record<string, unknown>;
    decision?: string;
    locale?: string;
    createdAt: Date;
  }): ShareSnapshot {
    const calories = this.num(input.totals.calories) || this.sumFood(input.foods, 'calories');
    const protein = this.num(input.totals.protein) || this.sumFood(input.foods, 'protein');
    const sugar = this.num(input.totals.sugar) || this.num(input.totals.sugars) || this.sumFood(input.foods, 'sugar');
    const sodium = this.num(input.totals.sodium) || this.sumFood(input.foods, 'sodium');
    const first = input.foods[0]?.name ?? 'This meal';
    const second = input.foods[1]?.name;
    const betterChoice = this.pickBetterChoice(input.foods);
    const hook = this.buildHook(input.shareType, input.score, first, second, sugar, sodium, betterChoice);
    const highlights = this.buildHighlights(protein, input.score, betterChoice);
    const risks = this.buildRisks(sugar, sodium, input.decision);
    const seoTitle =
      input.shareType === 'compare' && second
        ? `${first} vs ${second}: AI nutrition comparison`
        : input.title;
    const seoDescription = input.summary.slice(0, 300);

    return {
      version: 1,
      type: input.shareType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      subtitle: input.shareType === 'compare' && second ? `${first} VS ${second}` : 'AI analyzed this meal',
      hook,
      summary: input.summary,
      score: input.score,
      decision: input.decision,
      betterChoice,
      imageUrl: input.imageUrl,
      metrics: [
        { label: 'Calories', value: Math.round(calories), unit: 'kcal', tone: 'neutral' },
        { label: 'Protein', value: Math.round(protein), unit: 'g', tone: protein >= 20 ? 'good' : 'neutral' },
        { label: 'Sugar', value: Math.round(sugar), unit: 'g', tone: sugar >= 35 ? 'warning' : 'neutral' },
        { label: 'Sodium', value: Math.round(sodium), unit: 'mg', tone: sodium >= 900 ? 'warning' : 'neutral' },
      ],
      highlights,
      risks,
      foods: input.foods,
      cta: {
        label: 'Scan your own meal',
        appStoreUrl: this.appStoreUrl,
        googlePlayUrl: this.googlePlayUrl,
      },
      brand: {
        name: 'EatCheck',
        tagline: 'AI nutrition decisions in seconds',
      },
      seo: {
        title: seoTitle,
        description: seoDescription,
        indexable: false,
      },
      createdAt: input.createdAt.toISOString(),
    };
  }

  private buildTitle(type: ShareType, foods: ShareSnapshot['foods'], score?: number): string {
    const first = foods[0]?.name ?? 'Meal';
    const second = foods[1]?.name;
    if (type === 'compare' && second) return `${first} vs ${second}`;
    if (type === 'shock_insight') return `AI found something in ${first}`;
    if (type === 'weekly_summary') return 'My weekly nutrition trend';
    return `Meal Score ${score ?? 0}/100`;
  }

  private buildHook(
    type: ShareType,
    score: number | undefined,
    first: string,
    second: string | undefined,
    sugar: number,
    sodium: number,
    betterChoice?: string,
  ): string {
    if (type === 'compare' && second) {
      return `${first} vs ${second}: ${betterChoice ?? first} looks like the better choice.`;
    }
    if (type === 'shock_insight') {
      if (sugar >= 39) return `This has more sugar than a can of Coke.`;
      if (sodium >= 1500) return `This meal is close to a full-day sodium warning zone.`;
      return `This meal had a nutrition surprise.`;
    }
    if (type === 'weekly_summary') return 'Small changes, visible nutrition momentum.';
    return `Meal Score ${score ?? 0}/100`;
  }

  private buildHighlights(protein: number, score?: number, betterChoice?: string): string[] {
    const out: string[] = [];
    if (score && score >= 75) out.push('Strong overall nutrition score');
    if (protein >= 20) out.push('Good protein support');
    if (betterChoice) out.push(`${betterChoice} is the better choice`);
    if (out.length === 0) out.push('Clear AI summary for faster food decisions');
    return out.slice(0, 3);
  }

  private buildRisks(sugar: number, sodium: number, decision?: string): string[] {
    const out: string[] = [];
    if (sugar >= 35) out.push('Sugar is worth watching');
    if (sodium >= 900) out.push('Sodium is slightly high');
    if (decision && ['avoid', 'AVOID', 'STOP'].includes(decision)) out.push('AI recommends caution');
    return out.slice(0, 3);
  }

  private pickBetterChoice(foods: ShareSnapshot['foods']): string | undefined {
    if (foods.length < 2) return undefined;
    const ranked = [...foods].sort((a, b) => {
      const aScore = (a.protein ?? 0) * 5 - (a.sugar ?? 0) * 3 - (a.sodium ?? 0) / 100 - (a.calories ?? 0) / 20;
      const bScore = (b.protein ?? 0) * 5 - (b.sugar ?? 0) * 3 - (b.sodium ?? 0) / 100 - (b.calories ?? 0) / 20;
      return bScore - aScore;
    });
    return ranked[0]?.name;
  }

  private extractFoods(raw: unknown): ShareSnapshot['foods'] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.asObject(item))
      .map((item) => ({
        name: this.str(item.name) || this.str(item.foodName) || 'Food',
        calories: this.num(item.calories) || this.num(item.energyKcal),
        protein: this.num(item.protein),
        sugar: this.num(item.sugar) || this.num(item.sugars),
        sodium: this.num(item.sodium),
      }))
      .slice(0, 6);
  }

  private sumFood(foods: ShareSnapshot['foods'], key: 'calories' | 'protein' | 'sugar' | 'sodium'): number {
    return foods.reduce((sum, food) => sum + (food[key] ?? 0), 0);
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private num(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private async generateUniqueToken(): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const token = randomBytes(9).toString('base64url');
      const rows = await this.prisma.$queryRaw<Array<{ token: string }>>`
        SELECT token FROM growth_shares WHERE token = ${token} LIMIT 1
      `;
      if (rows.length === 0) return token;
    }
    throw new BadRequestException('Unable to allocate share token');
  }

  private mapPublicShare(row: GrowthShareRow): PublicShareResponse {
    const snapshot = row.snapshot as unknown as ShareSnapshot;
    return {
      id: row.id,
      token: row.token,
      shareType: row.share_type,
      sourceType: row.source_type,
      visibility: row.visibility,
      status: row.status,
      locale: row.locale ?? undefined,
      title: row.title ?? snapshot.seo.title,
      description: row.description ?? snapshot.seo.description,
      snapshot,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at?.toISOString(),
    };
  }

  private async cacheShare(share: PublicShareResponse): Promise<void> {
    const cacheKey = this.redis.buildKey('growth_share', share.token);
    await this.redis.set(cacheKey, share, 10 * 60 * 1000);
  }
}
