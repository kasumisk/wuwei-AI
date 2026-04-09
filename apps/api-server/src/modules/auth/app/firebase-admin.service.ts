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

    // 复用已有实例（热重载场景）
    try {
      this.app = admin.app('app-auth');
      this.logger.log('复用已有 Firebase Admin 实例 [app-auth]');
      return;
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
        };
        if (httpAgent) opts.httpAgent = httpAgent;
        this.app = admin.initializeApp(opts, 'app-auth');
        this.logger.log('Firebase Admin 初始化成功 [app-auth]（JSON 字符串）');
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
      };
      if (httpAgent) opts.httpAgent = httpAgent;
      this.app = admin.initializeApp(opts, 'app-auth');
      this.logger.log(
        `Firebase Admin 初始化成功 [app-auth]（文件: ${filePath}）`,
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
        this.logger.error(
          `Firebase Token 验证失败: ${error?.errorInfo?.code ?? error?.message ?? error}`,
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
}
