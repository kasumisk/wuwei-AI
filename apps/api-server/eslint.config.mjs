// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import i18nPlugin from './eslint-plugin-i18n.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'eslint-plugin-i18n.mjs',
      'dist/**',
      'node_modules/**',
      '**/*.spec.ts',
      '**/*.test.ts',
      'test/**',
      'debug-auth.ts',
      'test-proxy.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      i18n: i18nPlugin,
    },
  },
  {
    rules: {
      // 类型安全相关 - 关闭以简化开发
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',

      // 模板字符串相关
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',

      // 异步相关 - 改为警告
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/require-await': 'warn',

      // 未使用变量 - 保持警告
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // i18n 治理（先以 warn 落地，待存量清零后改 error）
      'i18n/no-cjk-literal': 'warn',
      'i18n/no-locale-ternary': 'warn',
    },
  },
);
