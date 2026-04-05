import { SetMetadata } from '@nestjs/common';

/**
 * 标记端点为公开访问（跳过认证）
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
