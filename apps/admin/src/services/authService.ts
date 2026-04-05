import request from '@/utils/request';
import { PATH } from './path';
import type {
  LoginRequestDto,
  LoginResponseDto,
  SendCodeRequestDto,
  SendCodeResponseDto,
  UserDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type { LoginRequestDto, LoginResponseDto, SendCodeRequestDto, SendCodeResponseDto, UserDto };

export interface LoginByTokenParams {
  token: string;
}

const authApi = {
  /**
   * Token 登录
   * @param params Token 登录参数
   */
  authBytoken: (params: LoginByTokenParams): Promise<LoginResponseDto> => {
    return request.post(PATH.USER_ADMIN.LOGIN_BY_TOKEN, params);
  },

  /**
   * 发送验证码
   * @param params 发送验证码参数
   */
  sendCode: (params: SendCodeRequestDto): Promise<SendCodeResponseDto> => {
    return request.post(PATH.USER_ADMIN.AUTHEN_SEND_CODE, params);
  },

  /**
   * 用户登录
   * @param params 登录参数
   */
  login: (params: LoginRequestDto): Promise<LoginResponseDto> => {
    return request.post(PATH.USER_ADMIN.AUTHEN_LOGIN, params);
  },

  /**
   * 获取用户信息
   */
  getUserInfo: (): Promise<UserDto> => {
    return request.get(PATH.USER_ADMIN.INFO);
  },
};

export default authApi;
