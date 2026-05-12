/**
 * ComfyUIService
 *
 * 封装 ComfyUI HTTP API 交互：
 *   - 提交 txt2img 任务（FLUX Dev fp8）
 *   - 轮询等待完成
 *   - 下载生成图片为 Buffer
 *   - 健康检查
 *
 * 服务器：117.50.178.130:8188
 * 模型：flux1-dev-fp8.safetensors（RTX 4090，约 40-50s / 张）
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface ComfyUISubmitResult {
  promptId: string;
}

export interface ComfyUIImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 轮询间隔 ms */
const POLL_INTERVAL_MS = 5_000;
/** 最大等待次数（5s × 120 = 10 min） */
const MAX_POLL_ATTEMPTS = 120;
/** SaveImage 节点 ID（workflow 固定） */
const SAVE_NODE_ID = '8';

@Injectable()
export class ComfyUIService {
  private readonly logger = new Logger(ComfyUIService.name);
  private readonly baseUrl: string;
  private readonly clientId = 'eatcheck-nestjs';

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('COMFYUI_BASE_URL') ??
      'http://117.50.178.130:8188';
  }

  // ─── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 提交生成任务，返回 prompt_id
   */
  async queuePrompt(foodId: string, promptText: string): Promise<string> {
    const workflow = this.buildWorkflow(foodId, promptText);
    const url = `${this.baseUrl}/prompt`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(
        `ComfyUI /prompt 失败: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as {
      prompt_id: string;
      node_errors: Record<string, unknown>;
    };

    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      throw new Error(
        `ComfyUI workflow 错误: ${JSON.stringify(data.node_errors)}`,
      );
    }

    this.logger.debug(`[${foodId}] ComfyUI 已提交 promptId=${data.prompt_id}`);
    return data.prompt_id;
  }

  /**
   * 轮询等待任务完成，返回第一张图片的 filename
   */
  async waitForResult(promptId: string): Promise<ComfyUIImageOutput> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);

      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.logger.warn(
          `ComfyUI /history/${promptId} 返回 ${res.status}，继续轮询`,
        );
        continue;
      }

      const data = (await res.json()) as Record<string, any>;
      const job = data[promptId];

      if (!job) continue; // 未完成

      const status = job?.status;
      if (status?.status_str === 'success' && status?.completed) {
        const images: ComfyUIImageOutput[] =
          job?.outputs?.[SAVE_NODE_ID]?.images ?? [];
        if (images.length === 0) {
          throw new Error(
            `ComfyUI 任务成功但无图片输出 (promptId=${promptId})`,
          );
        }
        return images[0];
      }

      if (
        status?.status_str &&
        status.status_str !== 'success' &&
        status?.completed
      ) {
        throw new Error(
          `ComfyUI 任务失败: ${status.status_str} (promptId=${promptId})`,
        );
      }
    }

    throw new Error(
      `ComfyUI 轮询超时（${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s）promptId=${promptId}`,
    );
  }

  /**
   * 下载生成图片为 Buffer
   */
  async downloadImage(image: ComfyUIImageOutput): Promise<Buffer> {
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const url = `${this.baseUrl}/view?${params}`;

    let lastErr: Error | undefined;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        lastErr = err as Error;
        this.logger.warn(
          `ComfyUI 下载图片失败 (attempt ${i + 1}/3): ${(err as Error).message}`,
        );
        await sleep(2_000);
      }
    }
    throw new Error(`ComfyUI 下载图片失败（重试 3 次）: ${lastErr?.message}`);
  }

  /**
   * 健康检查：返回 true 表示服务可用
   */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Workflow Builder ─────────────────────────────────────────────────────

  /**
   * 构建 FLUX Dev fp8 txt2img workflow JSON
   *
   * 参数选择依据（减少 AI 感）：
   *  - steps=28：FLUX Dev fp8 最佳甜点，低于 20 细节不足/高于 35 过渡渲染
   *  - cfg=1.0：FLUX 原生 guidance，不需要高 CFG（高 CFG 反而塑料感）
   *  - sampler=euler_ancestral：引入随机性，纹理更自然，比 euler 少「AI 打磨感」
   *  - scheduler=beta：FLUX 推荐调度器，噪声曲线更平滑
   *  - 分辨率 768×768：细节充分，避免 512 低分辨率下模型「猜测填充」
   */
  buildWorkflow(foodId: string, promptText: string): Record<string, unknown> {
    const seed = Math.floor(Math.random() * 999_999_999);
    return {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'flux1-dev-fp8.safetensors',
          weight_dtype: 'fp8_e4m3fn',
        },
      },
      '2': {
        class_type: 'DualCLIPLoader',
        inputs: {
          clip_name1: 't5xxl_fp8_e4m3fn.safetensors',
          clip_name2: 'clip_l.safetensors',
          type: 'flux',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: { vae_name: 'ae.safetensors' },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: { text: promptText, clip: ['2', 0] },
      },
      '9': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: '3d render, cgi, vray, octane render, unreal engine, cartoon, illustration, painting, drawing, anime, digital art, synthetic, plastic texture, over-smoothed skin, airbrushed, perfect symmetry, studio strobe lighting, pure white background, marble surface, slate board, oversaturated, overexposed, HDR, lens flare overlay, watermark, text, blurry, low quality',
          clip: ['2', 0],
        },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      '6': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['4', 0],
          negative: ['9', 0],
          latent_image: ['5', 0],
          seed,
          steps: 28,
          cfg: 1.0,
          sampler_name: 'euler_ancestral',
          scheduler: 'beta',
          denoise: 1.0,
        },
      },
      '7': {
        class_type: 'VAEDecode',
        inputs: { samples: ['6', 0], vae: ['3', 0] },
      },
      '8': {
        class_type: 'SaveImage',
        inputs: {
          images: ['7', 0],
          filename_prefix: `food_${foodId.slice(0, 8)}`,
        },
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
