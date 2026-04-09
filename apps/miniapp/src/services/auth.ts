import { post, get, put } from './request';
import type { LoginResponse, UserInfo } from '@/types/api';

/** 微信小程序登录 */
export function wechatMiniLogin(code: string) {
  return post<LoginResponse>('/app/auth/wechat/mini-login', { code }, { noAuth: true });
}

/** 手机号验证码登录 */
export function phoneLogin(phone: string, code: string) {
  return post<LoginResponse>('/app/auth/phone/verify', { phone, code }, { noAuth: true });
}

/** 发送手机验证码 */
export function sendPhoneCode(phone: string) {
  return post<null>('/app/auth/phone/send-code', { phone }, { noAuth: true });
}

/** 获取当前用户信息 */
export function getProfile() {
  return get<UserInfo>('/app/auth/profile');
}

/** 更新用户资料 */
export function updateProfile(data: { nickname?: string; avatar?: string }) {
  return put<UserInfo>('/app/auth/profile', data);
}

/** 刷新 Token */
export function refreshToken() {
  return post<{ token: string }>('/app/auth/refresh');
}
