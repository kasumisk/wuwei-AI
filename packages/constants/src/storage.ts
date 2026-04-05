/**
 * LocalStorage 键名
 */
export const STORAGE_KEY = {
  TOKEN: 'token',
  REFRESH_TOKEN: 'refresh_token',
  USER_INFO: 'user_info',
  THEME: 'theme',
  LOCALE: 'locale',
  TABS: 'tabs',
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
} as const;

/**
 * SessionStorage 键名
 */
export const SESSION_KEY = {
  TEMP_DATA: 'temp_data',
  FORM_CACHE: 'form_cache',
} as const;

/**
 * Cookie 键名
 */
export const COOKIE_KEY = {
  SESSION_ID: 'session_id',
  REMEMBER_ME: 'remember_me',
} as const;
