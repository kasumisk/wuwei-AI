'use client';

/**
 * @deprecated 请使用 `@/lib/api/user/auth` 代替
 * 此文件保留仅用于向后兼容
 */

export {
  appAuthService as default,
  appAuthService,
  type AppUserInfo,
  type AppLoginResponse,
} from './user/auth';

import appAuthService from './user/auth';

export const anonymousLogin = appAuthService.anonymousLogin;
export const googleLogin = appAuthService.googleLogin;
export const loginWithFirebase = appAuthService.loginWithFirebase;
export const emailRegister = appAuthService.emailRegister;
export const emailLogin = appAuthService.emailLogin;
export const emailCodeLogin = appAuthService.emailCodeLogin;
export const sendEmailCode = appAuthService.sendEmailCode;
export const resetPassword = appAuthService.resetPassword;
export const getProfile = appAuthService.getProfile;
export const updateProfile = appAuthService.updateProfile;
export const upgradeAnonymous = appAuthService.upgradeAnonymous;
export const refreshToken = appAuthService.refreshToken;
export const logout = appAuthService.logout;
export const sendPhoneCode = appAuthService.sendPhoneCode;
export const phoneLogin = appAuthService.phoneLogin;
export const getWechatAuthUrl = appAuthService.getWechatAuthUrl;
export const wechatLogin = appAuthService.wechatLogin;
