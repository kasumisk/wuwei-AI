import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

/** Firebase verifyIdToken 超时时间（毫秒）*/
const VERIFY_TIMEOUT_MS = 8_000;

/**
 * 候选凭证文件名（按优先级排序），相对于 process.cwd()
 * process.cwd() 在 `nest start` / `ts-node` 时均为 apps/api-server 目录
 */
const FALLBACK_CREDENTIAL_FILES = [
  'procify-toolkit-firebase.json',
  'firebase-service-account.json',
  'service-account.json',
];

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app: admin.app.App | null = null;
  private projectId: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // ── 构建代理（本地开发用，生产环境不配置 PROXY_HOST 即跳过）──
    const proxyHost = this.configService.get<string>('PROXY_HOST');
    const proxyPort = this.configService.get<string>('PROXY_PORT');
    let httpAgent: Agent | undefined;
    if (proxyHost && proxyPort) {
      const proxyUser = this.configService.get<string>('PROXY_USERNAME') || '';
      const proxyPass = this.configService.get<string>('PROXY_PASSWORD') || '';
      const auth = proxyUser && proxyPass ? `${proxyUser}:${proxyPass}@` : '';
      const proxyUrl = `http://${auth}${proxyHost}:${proxyPort}`;
      httpAgent = new HttpsProxyAgent(proxyUrl);

      // firebase-admin 的 Auth 操作使用 google-auth-library 发起 HTTPS 请求，
      // 不受 AppOptions.httpAgent 控制，需要通过环境变量让其走代理。
      // 仅在变量未设置时写入，避免覆盖用户的全局代理配置。
      if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.HTTP_PROXY = proxyUrl;
      }
      this.logger.log(`Firebase SDK 将通过代理连接: ${proxyHost}:${proxyPort}`);
    }

    // 开发态 watch 模式下，service account 文件经常被替换。
    // 若继续复用同名实例，会导致进程持有旧项目凭证，表现为 verifyIdToken
    // 持续报 argument-error / token mismatch。生产环境仍优先复用。
    const shouldReuseExistingApp =
      this.configService.get<string>('NODE_ENV') === 'production';

    // 复用已有实例（主要用于生产 / 单次启动场景）
    try {
      const existing = admin.app('app-auth');
      if (shouldReuseExistingApp) {
        this.app = existing;
        this.projectId =
          typeof existing.options.projectId === 'string'
            ? existing.options.projectId
            : null;
        this.logger.log(
          `复用已有 Firebase Admin 实例 [app-auth]（projectId=${this.projectId ?? 'unknown'}）`,
        );
        return;
      }

      existing.delete().catch(() => undefined);
      this.logger.warn(
        '检测到开发态热重载，已丢弃旧 Firebase Admin 实例 [app-auth]',
      );
    } catch {
      // 实例不存在，继续创建
    }

    // 方式一：FIREBASE_SERVICE_ACCOUNT 环境变量（JSON 字符串，优先级最高）
    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT',
    );
    if (serviceAccountJson) {
      try {
        const parsed = JSON.parse(serviceAccountJson);
        const opts: admin.AppOptions = {
          credential: admin.credential.cert(parsed),
          projectId: parsed.project_id,
        };
        if (httpAgent) opts.httpAgent = httpAgent;
        this.app = admin.initializeApp(opts, 'app-auth');
        this.projectId = parsed.project_id ?? null;
        this.logger.log(
          `Firebase Admin 初始化成功 [app-auth]（JSON 字符串, projectId=${this.projectId ?? 'unknown'}）`,
        );
        return;
      } catch (error: any) {
        this.logger.error(
          `Firebase Admin 初始化失败（JSON 字符串）: ${error?.message}`,
        );
      }
    }

    // 方式二：FIREBASE_CREDENTIALS_PATH 自定义路径（避免与系统 GOOGLE_APPLICATION_CREDENTIALS 冲突）
    const customPath = this.configService.get<string>(
      'FIREBASE_CREDENTIALS_PATH',
    );
    if (customPath && this.tryLoadFromFile(customPath, httpAgent)) return;

    // 方式三：从 process.cwd() 自动探测本地凭证文件
    for (const filename of FALLBACK_CREDENTIAL_FILES) {
      const autoPath = path.resolve(process.cwd(), filename);
      if (fs.existsSync(autoPath)) {
        if (this.tryLoadFromFile(autoPath, httpAgent)) return;
      }
    }

    this.logger.warn(
      'Firebase 凭证未配置，Firebase 登录功能将不可用。' +
        '请在 .env 中设置 FIREBASE_SERVICE_ACCOUNT（JSON 字符串）' +
        '或 FIREBASE_CREDENTIALS_PATH（文件绝对路径）',
    );
  }

  /** 从文件路径加载凭证，成功返回 true */
  private tryLoadFromFile(filePath: string, httpAgent?: Agent): boolean {
    if (!fs.existsSync(filePath)) {
      this.logger.error(`Firebase 凭证文件不存在: ${filePath}`);
      return false;
    }
    try {
      const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const opts: admin.AppOptions = {
        credential: admin.credential.cert(fileContent),
        projectId: fileContent.project_id,
      };
      if (httpAgent) opts.httpAgent = httpAgent;
      this.app = admin.initializeApp(opts, 'app-auth');
      this.projectId = fileContent.project_id ?? null;
      this.logger.log(
        `Firebase Admin 初始化成功 [app-auth]（文件: ${filePath}, projectId=${this.projectId ?? 'unknown'}）`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        `Firebase Admin 初始化失败（文件方式）: ${error?.message}`,
      );
      return false;
    }
  }

  /**
   * 验证 Firebase ID Token
   * 返回 null 表示验证失败，不抛出异常
   */
  async verifyIdToken(
    idToken: string,
  ): Promise<admin.auth.DecodedIdToken | null> {
    if (!this.app) {
      this.logger.error('Firebase Admin 未初始化，无法验证 token');
      return null;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error(
              `verifyIdToken 超时（>${VERIFY_TIMEOUT_MS}ms），请检查代理或网络连通性`,
            ),
          ),
        VERIFY_TIMEOUT_MS,
      );
    });

    try {
      const tokenParts = idToken.split('.');
      if (tokenParts.length !== 3) {
        this.logger.error(
          `Firebase Token 格式非法：JWT 段数=${tokenParts.length}，projectId=${this.projectId ?? 'unknown'}`,
        );
        return null;
      }

      const result = await Promise.race([
        this.app.auth().verifyIdToken(idToken),
        timeoutPromise,
      ]);
      return result;
    } catch (error: any) {
      const isTimeout = error?.message?.includes('超时');
      if (isTimeout) {
        this.logger.error(
          `Firebase verifyIdToken 超时（>${VERIFY_TIMEOUT_MS}ms）` +
            `，代理 HTTPS_PROXY=${process.env.HTTPS_PROXY ?? '未设置'}` +
            '，请确认代理是否可用',
        );
      } else {
        const tokenPreview = this.inspectJwt(idToken);
        const devDecodedToken = this.decodeTokenForLocalDevelopment(idToken);
        if (devDecodedToken) {
          this.logger.warn(
            `Firebase verifyIdToken 失败，但当前为开发环境，且 token 已匹配项目 claims；` +
              `已启用本地开发兜底登录（projectId=${this.projectId ?? 'unknown'}）`,
          );
          return devDecodedToken;
        }

        this.logger.error(
          `Firebase Token 验证失败: ${error?.errorInfo?.code ?? error?.message ?? error}; ` +
            `projectId=${this.projectId ?? 'unknown'}; ` +
            `aud=${tokenPreview.aud ?? 'n/a'}; ` +
            `iss=${tokenPreview.iss ?? 'n/a'}; ` +
            `sub=${tokenPreview.sub ?? 'n/a'}`,
        );
      }
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * 根据 UID 获取 Firebase 用户信息
   */
  async getUser(uid: string): Promise<admin.auth.UserRecord | null> {
    if (!this.app) {
      return null;
    }
    try {
      return await this.app.auth().getUser(uid);
    } catch {
      return null;
    }
  }

  getCurrentProjectId(): string | null {
    return this.projectId;
  }

  private decodeTokenForLocalDevelopment(
    token: string,
  ): admin.auth.DecodedIdToken | null {
    if (this.configService.get<string>('NODE_ENV') === 'production') return null;

    const payload = this.decodeJwtPayload(token);
    if (!payload || !this.projectId) return null;

    const aud = typeof payload.aud === 'string' ? payload.aud : undefined;
    const iss = typeof payload.iss === 'string' ? payload.iss : undefined;
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;

    if (aud !== this.projectId) return null;
    if (iss !== `https://securetoken.google.com/${this.projectId}`) return null;
    if (!sub) return null;
    if (exp && exp * 1000 <= Date.now()) return null;

    return payload as admin.auth.DecodedIdToken;
  }

  private inspectJwt(token: string): {
    aud?: string;
    iss?: string;
    sub?: string;
  } {
    const payload = this.decodeJwtPayload(token);
    if (!payload) return {};

    return {
      aud: typeof payload.aud === 'string' ? payload.aud : undefined,
      iss: typeof payload.iss === 'string' ? payload.iss : undefined,
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    };
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      return JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
