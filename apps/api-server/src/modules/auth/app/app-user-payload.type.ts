/**
 * JWT 验证后注入到 request.user 的载荷类型
 * 对应 AppJwtStrategy.validate() 的返回值
 * 用于替代所有 Controller 中的 `user: any`
 */
export interface AppUserPayload {
  /** 用户 UUID */
  id: string;
  /** 认证方式 (anonymous / phone / wechat / email 等) */
  authType: string;
  /** 邮箱（可选，匿名用户无此字段） */
  email?: string;
  /** 昵称（可选） */
  nickname?: string;
  /** 固定值 'app'，区分 Admin 端 token */
  type: 'app';
}
