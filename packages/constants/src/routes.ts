/**
 * 路由路径常量
 */
export const ROUTE_PATH = {
  // 公共路由
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  NOT_FOUND: '/404',
  FORBIDDEN: '/403',
  SERVER_ERROR: '/500',

  // 功能路由
  DASHBOARD: '/dashboard',
  USER: '/user',
  SETTING: '/setting',
  PROFILE: '/profile',

  // AI 功能路由
  AI_CHAT: '/ai/chat',
  AI_MODELS: '/ai/models',
  AI_TEMPLATES: '/ai/templates',
  AI_HISTORY: '/ai/history',
} as const;

/**
 * 路由名称常量
 */
export const ROUTE_NAME = {
  HOME: 'Home',
  LOGIN: 'Login',
  REGISTER: 'Register',
  DASHBOARD: 'Dashboard',
  USER: 'User',
  SETTING: 'Setting',
  PROFILE: 'Profile',
  AI_CHAT: 'AI Chat',
  AI_MODELS: 'AI Models',
  AI_TEMPLATES: 'AI Templates',
  AI_HISTORY: 'AI History',
} as const;

/**
 * 公开路由（无需认证）
 */
export const PUBLIC_ROUTES = [
  ROUTE_PATH.LOGIN,
  ROUTE_PATH.REGISTER,
  ROUTE_PATH.FORGOT_PASSWORD,
  ROUTE_PATH.NOT_FOUND,
  ROUTE_PATH.FORBIDDEN,
  ROUTE_PATH.SERVER_ERROR,
] as const;
