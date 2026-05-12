/**
 * FoodImageEnrichmentService
 *
 * 食物图片 AI 生成全流程（food-pipeline 数据补全方向）：
 *   ComfyUI (FLUX Dev fp8) → GPT-4o Vision 审核 → Sharp WebP 压缩
 *   → StorageService (R2) → FoodImageEnrichmentJob / FoodImageCandidate DB 写入
 *   → foods.image_url 更新
 *
 * 环境变量：
 *   COMFYUI_BASE_URL   — ComfyUI 服务地址，默认 http://117.50.178.130:8188
 *   OPENROUTER_API_KEY — Vision 审核（复用 VisionApiClient）
 *   STORAGE_*          — R2/S3（复用 StorageService）
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharpLib from 'sharp';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sharp = (sharpLib as any).default ?? sharpLib;
import { StorageService } from '../../../storage/storage.service';
import { VisionApiClient } from '../../../modules/food/app/services/image/vision-api.client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ComfyUIService } from './comfyui.service';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const IMAGE_SIZE = 512;
const WEBP_QUALITY = 82;
const THUMB_SIZE = 128;
const THUMB_QUALITY = 75;
/** Vision 审核通过的最低质量分 */
const MIN_QUALITY_SCORE = 60;
/** Vision 拒绝时最多重新生成次数 */
const MAX_VISION_RETRIES = 2;

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface ImageEnrichmentJobPayload {
  foodId: string;
  /** 食物全局唯一编码，如 CN_RICE_WHITE_COOKED（用于文件命名） */
  foodCode: string;
  /** 食物中文名（用于 Vision 审核匹配） */
  foodName: string;
  /** 英文名（用于 prompt 生成，无则退化到 foodName） */
  foodNameEn?: string;
  /** 一级分类：grain/vegetable/fruit/meat/seafood/dairy/egg/legume/nut/fat/beverage/condiment/snack/other */
  category?: string;
  /** 食物形态：ingredient / dish / semi_prepared */
  foodForm?: string;
  /** USDA 食物组（如 "Vegetables and Vegetable Products"） */
  foodGroup?: string;
  /** 完整食材清单（用于多食材菜肴的 prompt 组合） */
  ingredientList?: string[];
  /** true = 即使已有图片也重新生成 */
  force?: boolean;
  /** true = 使用高级模型（当前 ComfyUI 统一使用 FLUX Dev fp8，保留字段向后兼容） */
  premium?: boolean;
}

export interface ImageEnrichmentResult {
  foodId: string;
  imageUrl: string;
  thumbnailUrl: string;
  qualityScore: number;
  skipped: boolean;
  skipReason?: string;
}

interface VisionReview {
  match: boolean;
  qualityScore: number;
  issues: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class FoodImageEnrichmentService {
  private readonly logger = new Logger(FoodImageEnrichmentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly vision: VisionApiClient,
    private readonly prisma: PrismaService,
    private readonly comfyui: ComfyUIService,
  ) {}

  // ─── 公开入口 ─────────────────────────────────────────────────────────────

  async enrich(
    payload: ImageEnrichmentJobPayload,
  ): Promise<ImageEnrichmentResult> {
    const {
      foodId,
      foodCode,
      foodName,
      foodNameEn,
      category,
      foodForm,
      foodGroup,
      ingredientList,
      force,
    } = payload;

    // 1. 已有图片且不强制 → 跳过
    if (!force) {
      const row = await this.prisma.food.findUnique({
        where: { id: foodId },
        select: { imageUrl: true },
      });
      if (row?.imageUrl) {
        return {
          foodId,
          imageUrl: row.imageUrl,
          thumbnailUrl: '',
          qualityScore: -1,
          skipped: true,
          skipReason: 'already_has_image',
        };
      }
    }

    const promptName = foodNameEn || foodName;
    const prompt = this.buildPrompt(promptName, {
      category,
      foodForm,
      foodGroup,
      ingredientList,
    });

    // 2. 创建 DB 任务记录
    const dbJob = await this.prisma.foodImageEnrichmentJob.create({
      data: {
        foodId,
        status: 'running',
        searchQuery: prompt,
        provider: 'comfyui',
        forceRefresh: force ?? false,
        startedAt: new Date(),
      },
    });

    this.logger.log(
      `[${foodId}] 开始生成 jobId=${dbJob.id} name="${promptName}"`,
    );

    try {
      // 3. ComfyUI 生成 + Vision 审核，最多重试 MAX_VISION_RETRIES 次
      //    每次重试只针对"有可能通过"的情况（质量分过低）
      //    "不匹配"类问题不重试——图片内容由 FLUX 决定，重试大概率相同结果
      let rawBuffer: Buffer | null = null;
      let review: VisionReview | null = null;
      let lastRejectReason = '';

      for (let attempt = 0; attempt <= MAX_VISION_RETRIES; attempt++) {
        // 提交 ComfyUI 任务
        const promptId = await this.comfyui.queuePrompt(foodId, prompt);
        const imageOutput = await this.comfyui.waitForResult(promptId);
        rawBuffer = await this.comfyui.downloadImage(imageOutput);

        // Vision 审核
        review = await this.reviewWithVision(rawBuffer, foodName);

        if (review.match && review.qualityScore >= MIN_QUALITY_SCORE) break;

        lastRejectReason = review.match
          ? `质量分过低: score=${review.qualityScore}`
          : `不匹配: ${review.issues.join('; ')}`;

        // 不匹配时不重试，直接退出循环——换提示词也无法解决 Vision 判定不匹配的问题
        if (!review.match) break;

        if (attempt < MAX_VISION_RETRIES) {
          this.logger.warn(
            `[${foodId}] Vision 审核未通过 (attempt ${attempt + 1}/${MAX_VISION_RETRIES + 1}), 重新生成: ${lastRejectReason}`,
          );
        }
      }

      // Vision 未通过：保存候选图（status=review_needed）后正常完成 job
      // 不抛错、不触发 BullMQ 重试，由人工在候选图列表中决定是否通过
      const visionPassed =
        review!.match && review!.qualityScore >= MIN_QUALITY_SCORE;
      if (!visionPassed) {
        this.logger.warn(
          `[${foodId}] Vision 审核未通过，保存待人工审核: ${lastRejectReason}`,
        );
      }

      // 4. Sharp 压缩
      const [webpFull, webpThumb] = await Promise.all([
        sharp(rawBuffer!)
          .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover' })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
        sharp(rawBuffer!)
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
          .webp({ quality: THUMB_QUALITY })
          .toBuffer(),
      ]);

      // 5. 上传到候选目录（与正式 foods/ 目录隔离，可随时整体清理）
      //    文件名规则：foods/candidates/{code}-{jobId8}.webp
      //    code 为食物全局唯一编码（如 CN_RICE_WHITE_COOKED），转小写+下划线保留
      const codeSlug = foodCode.toLowerCase().replace(/[^a-z0-9_]/g, '-');
      const jobSuffix = dbJob.id.slice(0, 8);
      const [imgResult, thumbResult] = await Promise.all([
        this.storage.uploadWithKey(
          webpFull,
          `foods/candidates/${codeSlug}-${jobSuffix}.webp`,
          'image/webp',
        ),
        this.storage.uploadWithKey(
          webpThumb,
          `foods/candidates/thumb/${codeSlug}-${jobSuffix}.webp`,
          'image/webp',
        ),
      ]);

      // 6. 写入候选图记录
      //    Vision 通过 → status=uploaded（等待人工 approve 后写回 foods）
      //    Vision 未通过 → status=review_needed（需人工判断是否可用）
      const candidate = await this.prisma.foodImageCandidate.create({
        data: {
          foodId,
          jobId: dbJob.id,
          imageUrl: imgResult.url,
          thumbnailUrl: thumbResult.url,
          storedUrl: imgResult.url,
          storedThumbnailUrl: thumbResult.url,
          source: 'comfyui',
          width: IMAGE_SIZE,
          height: IMAGE_SIZE,
          mimeType: 'image/webp',
          matchScore: review!.match ? 100 : 0,
          qualityScore: review!.qualityScore,
          finalScore: review!.qualityScore,
          aiReason: review!.issues.join('; ') || null,
          isFoodImage: true,
          isMatchedFood: review!.match,
          status: visionPassed ? 'uploaded' : 'review_needed',
        },
      });

      // 7. Vision 通过的候选图不自动写回 foods 主表
      //    由人工审核后通过 approve 接口将 storedUrl → foods.image_url
      //    避免污染正式食物库

      // 8. 更新 job 为完成
      await this.prisma.foodImageEnrichmentJob.update({
        where: { id: dbJob.id },
        data: {
          status: 'completed',
          candidateCount: 1,
          selectedCandidateId: candidate.id,
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `[${foodId}] 完成: score=${review!.qualityScore} url=${imgResult.url}`,
      );

      return {
        foodId,
        imageUrl: imgResult.url,
        thumbnailUrl: thumbResult.url,
        qualityScore: review!.qualityScore,
        skipped: false,
      };
    } catch (err) {
      // 记录失败状态
      await this.prisma.foodImageEnrichmentJob.update({
        where: { id: dbJob.id },
        data: {
          status: 'failed',
          errorMessage: (err as Error).message,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  // ─── Prompt Builder ────────────────────────────────────────────────────────

  /**
   * 构建 FLUX Dev fp8 减少 AI 感的提示词。
   *
   * 核心原则：
   *  1. 用「场景描述」而非「指令词」— FLUX 读到的应该像一段照片描述，
   *     不是「photorealistic, high quality, ultra-detailed」这类触发过渲染的词
   *  2. 锚定真实摄影参数 — 镜头焦距、光线方向、材质细节，给模型具体锚点
   *  3. 去掉「no text / no watermark」— FLUX Dev 本身不生成文字，
   *     这类否定词有时反而提示模型「文字区域」的存在
   *  4. 分类差异化风格，避免所有食物都走同一模板
   */
  buildPrompt(
    foodName: string,
    meta?: {
      category?: string;
      foodForm?: string;
      foodGroup?: string;
      ingredientList?: string[];
    },
  ): string {
    const { category, foodForm, foodGroup, ingredientList } = meta ?? {};

    // 饮品走专属模板
    if (this.isBeverage(category, foodGroup, foodName)) {
      return this.buildBeveragePrompt(foodName);
    }

    // 成品菜 / 半成品
    if (foodForm === 'dish' || foodForm === 'semi_prepared') {
      return this.buildDishPrompt(foodName, category, ingredientList);
    }

    // 原材料 / 未知
    return this.buildIngredientPrompt(foodName, category);
  }

  private isBeverage(
    category?: string,
    foodGroup?: string,
    name?: string,
  ): boolean {
    if (category === 'beverage') return true;
    if (foodGroup?.toLowerCase().includes('beverages')) return true;
    if (
      name &&
      /饮|茶|咖|奶|汁|水|酒|汤|juice|tea|coffee|milk|water|drink|soda/i.test(
        name,
      )
    )
      return true;
    return false;
  }

  /**
   * 成品菜提示词
   *
   * 策略：强调「餐厅摆盘一角」的真实感，用具体的器皿/桌面材质锚定场景，
   * 避免「studio」类词导致的过度打光感。
   */
  private buildDishPrompt(
    foodName: string,
    category?: string,
    ingredientList?: string[],
  ): string {
    const hasChinese = /[\u4e00-\u9fff]/.test(foodName);
    const isChineseStyle =
      hasChinese ||
      /rice|noodle|dumpling|congee|bun|tofu|wonton|fried rice|lo mein/i.test(
        foodName,
      );

    // 最多附加 2 个主食材，避免 prompt 过长分散注意力
    const ingredientHint =
      ingredientList && ingredientList.length > 0 && !hasChinese
        ? `, with ${ingredientList.slice(0, 2).join(' and ')}`
        : '';

    if (isChineseStyle) {
      return (
        `photograph of ${foodName}${ingredientHint} served in a worn white ceramic bowl, ` +
        `placed on a scratched wooden dining table with visible grain, ` +
        `uneven natural window light, slight steam, ` +
        `casual home-style presentation, minor sauce drips on the bowl rim, ` +
        `grain from high ISO, shot on Canon R5 85mm f/2.8, ` +
        `warm ambient light, slightly muted colors`
      );
    }

    return (
      `photograph of ${foodName}${ingredientHint} on a restaurant plate, ` +
      `slightly imperfect plating with natural juice or sauce pooling, ` +
      `soft overcast window light from the left side, ` +
      `overhead 70-degree angle, visible food texture and surface moisture, ` +
      `shot on Sony A7IV 90mm f/2.5, shallow depth of field, ` +
      `muted warm background, slight lens distortion at edges`
    );
  }

  /**
   * 原材料提示词
   *
   * 策略：「扁平产品图」风格，锚定具体表面材质，
   * 去掉「photorealistic」改为描述真实拍摄场景。
   */
  private buildIngredientPrompt(foodName: string, category?: string): string {
    const isMeat =
      category === 'meat' || category === 'seafood' || category === 'protein';

    if (isMeat) {
      return (
        `photograph of raw ${foodName} on a worn wooden cutting board, ` +
        `natural surface moisture and slight marbling visible, ` +
        `overcast daylight from a side window, no harsh shadows, ` +
        `minor blood pooling and natural color variation, ` +
        `shot on Nikon Z7 50mm f/2, overhead flat lay, ` +
        `muted cool tones, slight film grain`
      );
    }

    // 蔬果、谷物、坚果等
    return (
      `photograph of ${foodName} on a plain off-white cotton cloth, ` +
      `overhead flat lay, natural daylight from a window, ` +
      `visible skin texture, blemishes and natural color variation, ` +
      `some pieces slightly irregular in shape, ` +
      `shot on Fujifilm X-T5 60mm macro, gentle one-sided shadow, ` +
      `desaturated natural tones, slight grain`
    );
  }

  /**
   * 饮品提示词
   *
   * 策略：透明玻璃杯 + 侧光折射，强调真实液体质感，
   * 避免「bright studio lighting」导致的过曝塑料感。
   */
  private buildBeveragePrompt(foodName: string): string {
    return (
      `photograph of ${foodName} in a plain glass on a cafe table, ` +
      `condensation droplets on the outside, slight fingerprint smudge on glass, ` +
      `natural window light from the side creating soft refraction, ` +
      `45-degree angle, out-of-focus background with warm ambient tones, ` +
      `shot on Sony A7III 85mm f/2, slight lens flare, muted cool tones, film grain`
    );
  }

  // ─── Vision 审核 ──────────────────────────────────────────────────────────

  private async reviewWithVision(
    imageBuffer: Buffer,
    foodName: string,
  ): Promise<VisionReview> {
    // ComfyUI 输出为 PNG；转 webp 后再 base64，减小传输体积
    const webpBuf = await sharp(imageBuffer).webp({ quality: 80 }).toBuffer();
    const dataUrl = `data:image/webp;base64,${webpBuf.toString('base64')}`;

    const systemPrompt =
      `You are a strict food photography critic reviewing AI-generated images for a nutrition app.\n\n` +
      `Target food: "${foodName}"\n\n` +
      `Evaluate on these criteria and return a qualityScore from 0-100:\n\n` +
      `SCORE GUIDE (be strict — most AI images should score 55-75):\n` +
      `90-100: Indistinguishable from a real food photo. Natural imperfections, realistic textures, authentic lighting.\n` +
      `75-89: Mostly realistic but minor AI tells (too-perfect symmetry, slightly unnatural sheen).\n` +
      `60-74: Noticeable AI feel — overly smooth surfaces, studio-perfect lighting, unnaturally vivid colors.\n` +
      `40-59: Strong AI artifacts — plastic texture, CGI shading, obviously synthetic.\n` +
      `0-39: Cartoon, illustration, abstract, or completely wrong subject.\n\n` +
      `Set match=false if the image does not show the correct food.\n` +
      `List specific issues in the issues array (e.g. "plastic texture on skin", "unnatural highlight on surface").\n\n` +
      `Return ONLY valid JSON, no markdown:\n` +
      `{"match":true,"qualityScore":72,"issues":["slightly over-smooth surface"]}`;

    try {
      const raw = await this.vision.complete(systemPrompt, dataUrl, '', '');
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!json) throw new Error('No JSON in vision response');
      const parsed = JSON.parse(json) as VisionReview;
      return {
        match: parsed.match ?? true,
        qualityScore: Number(parsed.qualityScore ?? 70),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    } catch (err) {
      this.logger.warn(
        `Vision 审核异常，标记 review_needed: ${(err as Error).message}`,
      );
      return { match: true, qualityScore: 0, issues: ['vision review failed'] };
    }
  }

  // ─── 工具 ────────────────────────────────────────────────────────────────

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[\s/\\]+/g, '-')
      .replace(/[^\w-]/g, '')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
