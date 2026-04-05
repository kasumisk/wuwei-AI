export const APP_NAME = 'ShadcnNext';
export const APP_DESCRIPTION = 'A modern Next.js application';

export const ROUTES = {
  HOME: '/',
  ABOUT: '/about',
  SETTINGS: '/settings',
} as const;

export const QUERY_KEYS = {
  USERS: 'users',
  USER: (id: string) => ['user', id],
  POSTS: 'posts',
  POST: (id: string) => ['post', id],
} as const;

export const STORAGE_KEYS = {
  THEME: 'theme',
  LOCALE: 'locale',
  USER: 'user',
} as const;
