import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from '../../../core/i18n';

/**
 * 微信网页扫码登录服务
 *
 * 流程（使用微信测试号 / 公众号网页授权）：
 * 1. 前端跳转微信授权 URL
 * 2. 用户微信扫码同意授权
 * 3. 微信回调到前端页面，带 code 参数
 * 4. 前端把 code 发给后端，后端用 code 换 access_token + openid
 * 5. 后端用 access_token 拉取用户信息
 * 6. 后端创建/查找用户，返回 JWT
 */

export interface WechatUserInfo {
  openid: string;
  unionid?: string;
  nickname?: string;
  headimgurl?: string;
  sex?: number;
}

export interface WechatMiniSessionResult {
  openid: string;
  session_key: string;
  unionid?: string;
}

@Injectable()
export class WechatAuthService {
  private readonly logger = new Logger(WechatAuthService.name);

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly miniAppId: string;
  private readonly miniAppSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    this.appId =
      this.configService.get<string>('WECHAT_APPID') || 'wx615a34b78f5fb359';
    this.appSecret =
      this.configService.get<string>('WECHAT_SECRET') ||
      '9b324b9b2884934f2904c683ad4f50fe';
    this.redirectUri =
      this.configService.get<string>('WECHAT_REDIRECT_URI') || '';
    this.miniAppId = this.configService.get<string>('WECHAT_MINI_APPID') || '';
    this.miniAppSecret =
      this.configService.get<string>('WECHAT_MINI_SECRET') || '';
    this.logger.log(`微信登录已配置, appId: ${this.appId}`);
    if (this.miniAppId) {
      this.logger.log(`微信小程序已配置, miniAppId: ${this.miniAppId}`);
    }
  }

  /**
   * 生成微信网页授权 URL（给前端跳转用）
   * 使用 snsapi_userinfo scope 获取用户信息
   *
   * @param state 防 CSRF，前端自定义字符串，回调时原样返回
   * @param redirectUri 授权后回调的前端页面地址
   */
  getAuthUrl(redirectUri: string, state?: string): string {
    const safeState = state || Math.random().toString(36).slice(2, 10);
    const scope = 'snsapi_userinfo';

    // 微信测试号使用此 URL 格式
    const url =
      `https://open.weixin.qq.com/connect/oauth2/authorize` +
      `?appid=${this.appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&state=${safeState}` +
      `#wechat_redirect`;

    return url;
  }

  /**
   * 用授权 code 换取 access_token + openid
   */
  private async getAccessToken(
    code: string,
  ): Promise<{ accessToken: string; openid: string }> {
    const url =
      `https://api.weixin.qq.com/sns/oauth2/access_token` +
      `?appid=${this.appId}` +
      `&secret=${this.appSecret}` +
      `&code=${code}` +
      `&grant_type=authorization_code`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      this.logger.error(`微信 access_token 获取失败: ${JSON.stringify(data)}`);
      throw new UnauthorizedException(
        `${this.i18n.t('auth.wechatAuthFailed')}: ${data.errmsg || ''}`.trim(),
      );
    }

    return {
      accessToken: data.access_token,
      openid: data.openid,
    };
  }

  /**
   * 用 access_token 拉取微信用户信息
   */
  private async getUserInfo(
    accessToken: string,
    openid: string,
  ): Promise<WechatUserInfo> {
    const url =
      `https://api.weixin.qq.com/sns/userinfo` +
      `?access_token=${accessToken}` +
      `&openid=${openid}` +
      `&lang=zh_CN`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      this.logger.error(`微信用户信息获取失败: ${JSON.stringify(data)}`);
      throw new UnauthorizedException(
        `${this.i18n.t('auth.wechatLoginFailed')}: ${data.errmsg || ''}`.trim(),
      );
    }

    return {
      openid: data.openid,
      unionid: data.unionid,
      nickname: data.nickname,
      headimgurl: data.headimgurl,
      sex: data.sex,
    };
  }

  /**
   * 完整微信登录流程：code → access_token → 用户信息
   */
  async loginWithCode(code: string): Promise<WechatUserInfo> {
    // 1. 用 code 换 access_token
    const { accessToken, openid } = await this.getAccessToken(code);

    // 2. 拉取用户信息
    const userInfo = await this.getUserInfo(accessToken, openid);

    this.logger.log(
      `微信登录成功: openid=${userInfo.openid}, nickname=${userInfo.nickname}`,
    );

    return userInfo;
  }

  /**
   * 微信小程序登录：code → openid + session_key
   * 调用 jscode2session 接口
   */
  async miniProgramLogin(code: string): Promise<WechatMiniSessionResult> {
    if (!this.miniAppId || !this.miniAppSecret) {
      throw new UnauthorizedException(this.i18n.t('auth.wechatNotConfigured'));
    }

    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${this.miniAppId}` +
      `&secret=${this.miniAppSecret}` +
      `&js_code=${code}` +
      `&grant_type=authorization_code`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      this.logger.error(`小程序 code2session 失败: ${JSON.stringify(data)}`);
      throw new UnauthorizedException(
        `${this.i18n.t('auth.wechatLoginFailed')}: ${data.errmsg || ''}`.trim(),
      );
    }

    this.logger.log(`小程序登录成功: openid=${data.openid}`);

    return {
      openid: data.openid,
      session_key: data.session_key,
      unionid: data.unionid,
    };
  }

  /**
   * 微信消息验签（用于微信测试号配置 URL 验证）
   * GET /api/app/auth/wechat/verify?signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
   */
  verifySignature(
    signature: string,
    timestamp: string,
    nonce: string,
  ): boolean {
    const token =
      this.configService.get<string>('WECHAT_TOKEN') || 'uway2026hello';
    const arr = [token, timestamp, nonce].sort();
    // 使用 crypto 进行 SHA1 计算
    const crypto = require('crypto');
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');

    return hash === signature;
  }
}
