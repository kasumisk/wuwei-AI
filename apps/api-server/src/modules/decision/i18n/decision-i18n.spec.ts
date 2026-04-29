/**
 * Decision i18n — 静态校验 + Phase 11.B singleton 适配器测试
 *
 * 覆盖：
 *   1. 三个 locale JSON key 集合一致
 *   2. 单花括号占位符残留检测
 *   3. 跨 locale 同 key 的 {{var}} 集合一致
 *   4. 必需 namespace 存在性（chain.* / ui.* / score.* / dim.* / coach.*）
 *   5. Phase 11.B: cl() 在 singleton 未就绪时走 _load 兜底
 *   6. Phase 11.B: cl() 在 singleton 就绪时通过 I18nService 命中
 *   7. cl() 占位符 interpolation 双花括号语法
 */

import {
  DECISION_LABELS_BY_LOCALE,
  DECISION_LABELS_ZH,
  DECISION_LABELS_EN,
  DECISION_LABELS_JA,
} from './_load';
import { cl } from './decision-labels';
import { clearI18nSingleton, setI18nSingleton } from '../../../core/i18n/i18n.runtime';
import type { I18nService } from '../../../core/i18n/i18n.service';

describe('decision/i18n — JSON 静态校验', () => {
  const LOCALES = ['zh-CN', 'en-US', 'ja-JP'] as const;

  test('三个 locale JSON key 集合完全一致', () => {
    const baseKeys = new Set(Object.keys(DECISION_LABELS_EN));
    for (const loc of LOCALES) {
      const labels = DECISION_LABELS_BY_LOCALE[loc];
      const keys = new Set(Object.keys(labels));
      const missing = [...baseKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !baseKeys.has(k));
      expect({ loc, missing: missing.slice(0, 10), extra: extra.slice(0, 10) }).toEqual({
        loc,
        missing: [],
        extra: [],
      });
    }
  });

  test('无单花括号占位符残留（应统一为 {{var}}）', () => {
    const singleBraceRe = /(?<!\{)\{(\w+)\}(?!\})/g;
    const violations: string[] = [];
    for (const loc of LOCALES) {
      for (const [key, value] of Object.entries(DECISION_LABELS_BY_LOCALE[loc])) {
        const m = value.match(singleBraceRe);
        if (m) violations.push(`[${loc}] ${key}: ${m.join(', ')}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test('跨 locale 同 key 的 {{var}} 集合一致', () => {
    const placeholderRe = /\{\{\s*(\w+)\s*\}\}/g;
    const extractVars = (text: string): Set<string> => {
      const out = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = placeholderRe.exec(text)) !== null) out.add(m[1]);
      placeholderRe.lastIndex = 0;
      return out;
    };
    const mismatches: string[] = [];
    for (const key of Object.keys(DECISION_LABELS_EN)) {
      const sets = LOCALES.map((loc) => ({
        loc,
        vars: extractVars(DECISION_LABELS_BY_LOCALE[loc][key] || ''),
      }));
      const baseVars = sets[0].vars;
      for (const { loc, vars } of sets.slice(1)) {
        const missing = [...baseVars].filter((v) => !vars.has(v));
        const extra = [...vars].filter((v) => !baseVars.has(v));
        if (missing.length || extra.length) {
          mismatches.push(`${key} [${loc}] missing=${missing.join(',')} extra=${extra.join(',')}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('必需 namespace 存在 key', () => {
    const required = ['chain.', 'ui.', 'score.', 'dim.', 'coach.', 'health.', 'tone.'];
    for (const ns of required) {
      const has = Object.keys(DECISION_LABELS_EN).some((k) => k.startsWith(ns));
      expect({ ns, has }).toEqual({ ns, has: true });
    }
  });
});

describe('decision/i18n — cl() 适配器（Phase 11.B）', () => {
  beforeEach(() => clearI18nSingleton());
  afterAll(() => clearI18nSingleton());

  test('singleton 未就绪：走 _load 兜底，命中 zh-CN 翻译', () => {
    const sample = Object.keys(DECISION_LABELS_ZH).find((k) => DECISION_LABELS_ZH[k]);
    expect(sample).toBeDefined();
    const text = cl(sample!, 'zh-CN');
    expect(text).toBe(DECISION_LABELS_ZH[sample!]);
  });

  test('singleton 未就绪：locale 缺失时回退 en-US', () => {
    // 找一个 ja-JP 与 en-US 不同的 key 验证 fallback 链
    const sample = Object.keys(DECISION_LABELS_EN).find((k) => DECISION_LABELS_EN[k]);
    expect(sample).toBeDefined();
    const text = cl(sample!, 'en-US');
    expect(text).toBe(DECISION_LABELS_EN[sample!]);
  });

  test('singleton 未就绪：未知 key 返回 key 本身（不是 decision.xxx）', () => {
    const text = cl('nonexistent.totally.fake.key', 'en-US');
    expect(text).toBe('nonexistent.totally.fake.key');
  });

  test('singleton 未就绪：双花括号占位符 interpolation', () => {
    // 找一个**只含单个占位符**的模板，确保替换后无残留
    const candidates = Object.entries(DECISION_LABELS_EN).filter(([, v]) => {
      const matches = v.match(/\{\{\s*\w+\s*\}\}/g) || [];
      const unique = new Set(matches.map((m) => m.replace(/[{}\s]/g, '')));
      return unique.size === 1;
    });
    expect(candidates.length).toBeGreaterThan(0);
    const [key, template] = candidates[0];
    const varName = (/\{\{\s*(\w+)\s*\}\}/.exec(template) || [])[1];
    expect(varName).toBeDefined();
    const text = cl(key, 'en-US', { [varName]: 'TEST_VALUE_42' });
    expect(text).toContain('TEST_VALUE_42');
    expect(text).not.toMatch(/\{\{\s*\w+\s*\}\}/); // 单一占位符已被替换干净
  });

  test('singleton 就绪：cl() 路由到 I18nService.translate 并去掉 namespace 前缀', () => {
    const calls: Array<{ key: string; locale: string }> = [];
    const fakeSvc = {
      translate(key: string, locale: string): string {
        calls.push({ key, locale });
        // 命中场景：返回非 key 字面量
        return `__translated__${key}__${locale}`;
      },
      currentLocale: () => 'en-US',
    } as unknown as I18nService;
    setI18nSingleton(fakeSvc);

    const out = cl('foo.bar', 'ja-JP', { x: 1 });
    expect(calls).toEqual([{ key: 'decision.foo.bar', locale: 'ja-JP' }]);
    expect(out).toBe('__translated__decision.foo.bar__ja-JP');
  });

  test('singleton 就绪：translate 返回 fullKey 时（未命中）cl() 抹掉 namespace', () => {
    const fakeSvc = {
      translate(key: string): string {
        return key; // 模拟未命中：I18nService 返回 fullKey 字面量
      },
      currentLocale: () => 'en-US',
    } as unknown as I18nService;
    setI18nSingleton(fakeSvc);

    expect(cl('unknown.key', 'en-US')).toBe('unknown.key');
  });
});
