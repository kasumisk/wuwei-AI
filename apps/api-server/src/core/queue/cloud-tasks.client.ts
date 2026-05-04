/**
 * CloudTasksClient — 封装 @google-cloud/tasks 的 thin wrapper。
 *
 * 设计目的：
 *   - 统一处理 Project/Region/Queue path 拼接与 OIDC token 配置；调用方只需传
 *     queueName + payload + opts。
 *   - 与 BullMQ 解耦：QueueProducer 在 backend=tasks 时调用此 client，不直接
 *     依赖 @google-cloud/tasks。
 *   - 支持 dispatch deadline、scheduleTime（延迟）、retry 配置。
 *   - 暴露 createHttpTask（HTTP target，指向 InternalTaskController）。
 *
 * 测试环境：本类不会被构造（QueueProducer 在 backend=bullmq 时不依赖它）。
 *           即使被注入也不会发起任何网络调用直到 createHttpTask 被调用。
 *
 * 必要的 GCP 资源（生产）：
 *   - 7~9 个 Cloud Tasks queues，命名约定 `<queue-name>` 直接对应 QUEUE_NAMES。
 *   - Runtime SA 需 roles/cloudtasks.enqueuer。
 *   - Internal Task Controller 所在 Cloud Run 服务，runtime SA 需 roles/run.invoker。
 *
 * 必要的 env：
 *   - GCP_PROJECT_ID            必填
 *   - CLOUD_TASKS_LOCATION      必填，本项目 us-east1
 *   - CLOUD_TASKS_HANDLER_URL   必填，形如 https://eatcheck-api-xxx.a.run.app/internal/tasks
 *   - CLOUD_TASKS_OIDC_SA_EMAIL 必填，runtime SA 邮箱（用于 OIDC token audience 验证）
 *   - CLOUD_TASKS_OIDC_AUDIENCE 选填，默认等于 CLOUD_TASKS_HANDLER_URL（不带尾斜杠的 origin）
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
// 仅引入类型，避免 TS 在 module:node16 + 包 type:module 下报 TS1479。
// 运行时通过 createRequire 加载 CJS 入口（package.json exports.require 指向 build/cjs/...）。
// resolution-mode: require 让 TS 走 cjs 类型入口（同样可用且无需 ESM 上下文）。
import type {
  CloudTasksClient as GoogleCloudTasksClientType,
  protos,
} from '@google-cloud/tasks' with { 'resolution-mode': 'require' };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tasksLib = createRequire(__filename)('@google-cloud/tasks') as {
  CloudTasksClient: new () => GoogleCloudTasksClientType;
};

export interface CreateHttpTaskOptions {
  /** Cloud Tasks queue 名称（不含 project/location 前缀），例如 "food-analysis" */
  queueName: string;
  /** payload 对象，将以 JSON.stringify 写入请求体 */
  payload: unknown;
  /** 自定义 task name（用于幂等去重，必须满足 [a-zA-Z0-9_-]{1,500}）；省略则由 Cloud Tasks 自动生成 */
  taskId?: string;
  /** 延迟分发（秒）。默认立即分发。 */
  scheduleDelaySeconds?: number;
  /** 单次 dispatch 的 deadline（秒）。默认 600（Cloud Tasks 上限 1800）。 */
  dispatchDeadlineSeconds?: number;
  /** 透传到 handler 的 HTTP headers（除 Content-Type / Authorization 外） */
  headers?: Record<string, string>;
  /**
   * 业务侧定义的子路径（追加到 CLOUD_TASKS_HANDLER_URL 之后）。
   * 不传则使用 `/${queueName}`。
   * 例：handler base = ".../internal/tasks"，queueName = "food-analysis"
   *     → 实际 URL = ".../internal/tasks/food-analysis"
   */
  pathOverride?: string;
}

@Injectable()
export class CloudTasksClient implements OnModuleDestroy {
  private readonly logger = new Logger(CloudTasksClient.name);
  private readonly client: GoogleCloudTasksClientType;
  private readonly projectId: string;
  private readonly location: string;
  private readonly handlerBaseUrl: string;
  private readonly oidcSaEmail: string;
  private readonly oidcAudience: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.projectId = this.requireEnv('GCP_PROJECT_ID');
    this.location = this.requireEnv('CLOUD_TASKS_LOCATION');
    this.handlerBaseUrl = this.normalizeBaseUrl(
      this.requireEnv('CLOUD_TASKS_HANDLER_URL'),
    );
    this.oidcSaEmail = this.requireEnv('CLOUD_TASKS_OIDC_SA_EMAIL');
    this.oidcAudience =
      this.config.get<string>('CLOUD_TASKS_OIDC_AUDIENCE') || undefined;

    // 默认凭证：Cloud Run 上自动使用挂载的 runtime SA；本地需 GOOGLE_APPLICATION_CREDENTIALS。
    this.client = new tasksLib.CloudTasksClient();
  }

  /** 仅生产环境会真实调用。返回创建后的 task name（含全路径）。 */
  async createHttpTask(opts: CreateHttpTaskOptions): Promise<string> {
    const parent = this.client.queuePath(this.projectId, this.location, opts.queueName);
    const url = this.buildHandlerUrl(opts.queueName, opts.pathOverride);
    const audience = this.oidcAudience ?? new URL(url).origin;

    const task: protos.google.cloud.tasks.v2.ITask = {
      // 不带 task name 时由 Cloud Tasks 自动分配；带 task name 时（必须是 fully-qualified）
      // 同名 task 在最近 ~1h 内会被拒绝创建（HTTP 409），用作天然去重。
      ...(opts.taskId
        ? {
            name: this.client.taskPath(
              this.projectId,
              this.location,
              opts.queueName,
              this.sanitizeTaskId(opts.taskId),
            ),
          }
        : {}),
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers ?? {}),
        },
        body: Buffer.from(JSON.stringify(opts.payload)),
        oidcToken: {
          serviceAccountEmail: this.oidcSaEmail,
          audience,
        },
      },
      ...(opts.dispatchDeadlineSeconds
        ? {
            dispatchDeadline: {
              seconds: opts.dispatchDeadlineSeconds,
            },
          }
        : {}),
      ...(opts.scheduleDelaySeconds && opts.scheduleDelaySeconds > 0
        ? {
            scheduleTime: {
              seconds: Math.floor(Date.now() / 1000) + opts.scheduleDelaySeconds,
            },
          }
        : {}),
    };

    try {
      const [response] = await this.client.createTask({ parent, task });
      this.logger.debug(
        `Cloud Tasks createTask ok: queue=${opts.queueName} name=${response.name}`,
      );
      return response.name ?? '';
    } catch (err) {
      // 同名 task 重复创建 → ALREADY_EXISTS（gRPC code 6）
      if (this.isAlreadyExists(err)) {
        this.logger.warn(
          `Cloud Tasks task already exists (idempotent skip): queue=${opts.queueName} taskId=${opts.taskId}`,
        );
        return '';
      }
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.close();
    } catch (err) {
      this.logger.warn(
        `CloudTasksClient close error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── helpers ───────────────────────────────────────────────────────────

  private requireEnv(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`CloudTasksClient: missing required env ${key}`);
    return v;
  }

  /** 删除尾部 `/`，避免与 path 拼接时出现 `//`。 */
  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private buildHandlerUrl(queueName: string, override?: string): string {
    const sub = override ?? `/${queueName}`;
    return `${this.handlerBaseUrl}${sub.startsWith('/') ? sub : `/${sub}`}`;
  }

  /**
   * Cloud Tasks task ID 限制：[a-zA-Z0-9_-]{1,500}。把不合规字符替换成 `_`。
   */
  private sanitizeTaskId(taskId: string): string {
    return taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 500);
  }

  private isAlreadyExists(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: number }).code;
    return code === 6; // gRPC ALREADY_EXISTS
  }
}
