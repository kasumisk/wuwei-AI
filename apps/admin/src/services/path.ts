const PATH = {
  FILE_S3: '/admin/files/upload',
  FILE_PRESIGNED: '/admin/files/presigned-url',
  USER_ADMIN: {
    LOGIN_BY_TOKEN: '/auth/login_by_token',
    AUTHEN_SEND_CODE: '/auth/send_code',
    AUTHEN_LOGIN: '/auth/login',
    INFO: '/auth/info',
  },
  ADMIN: {
    USERS: '/admin/users',
    CLIENTS: '/admin/clients',
    CAPABILITIES: '/admin/capabilities',
    PERMISSIONS: '/admin/permissions',
    PROVIDERS: '/admin/providers',
    ANALYTICS: '/admin/analytics',
    MODELS: '/admin/models',
    // RBAC 权限管理
    ROLES: '/admin/roles',
    RBAC_PERMISSIONS: '/admin/rbac-permissions',
    PERMISSION_TEMPLATES: '/admin/permission-templates',
    // 应用版本管理
    APP_VERSIONS: '/admin/app-versions',
    APP_VERSION_PACKAGES: (versionId: string) => `/admin/app-versions/${versionId}/packages`,
    APP_VERSION_STORE_DEFAULTS: '/admin/app-versions/store-defaults/packages',
    // App 用户管理
    APP_USERS: '/admin/app-users',
    // 食物库管理
    FOOD_LIBRARY: '/admin/food-library',
    FOOD_LIBRARY_CONFLICTS: '/admin/food-library/conflicts',
    // 食物数据管道
    FOOD_PIPELINE: '/admin/food-pipeline',
    // 内容管理
    CONTENT_FOOD_RECORDS: '/admin/content/food-records',
    CONTENT_DAILY_PLANS: '/admin/content/daily-plans',
    CONTENT_CONVERSATIONS: '/admin/content/conversations',
    CONTENT_RECOMMENDATION_FEEDBACK: '/admin/content/recommendation-feedback',
    CONTENT_AI_DECISION_LOGS: '/admin/content/ai-decision-logs',
    // 游戏化管理
    GAMIFICATION_ACHIEVEMENTS: '/admin/gamification/achievements',
    GAMIFICATION_CHALLENGES: '/admin/gamification/challenges',
  },
};

export { PATH };
