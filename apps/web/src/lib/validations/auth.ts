import { z } from 'zod';

// 用户表单验证
export const userSchema = z.object({
  name: z.string().min(2, '名称至少需要2个字符').max(50, '名称不能超过50个字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少需要8个字符'),
});

export type UserFormData = z.infer<typeof userSchema>;

// 登录表单验证
export const loginSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '密码不能为空'),
});

export type LoginFormData = z.infer<typeof loginSchema>;
