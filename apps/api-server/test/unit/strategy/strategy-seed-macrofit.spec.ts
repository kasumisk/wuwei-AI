/**
 * P0-D 根因#2 修复 · 8 处 seed 策略 preferences 必须含 macroFit 字段
 *
 * 背景：上一轮 P0 给 DEFAULT_PREFERENCES 加了 macroFit=0.35，依赖
 * resolvePreferences 的 spread 合并兜底。但实际路径是：
 *   strategy.multiObjective.preferences (seed 无 macroFit)
 *   → mergeMultiObjective
 *   → resolvePreferences
 *   → 归一化后 macroFit 仍仅 26%，health+taste 合计 55% 主导
 *
 * 本轮直接在 8 处 seed 策略 preferences 里显式写入 macroFit。
 * 本测试确保未来新增策略不会漏写，并锁定现有策略的 macroFit 权重。
 */

import { PRESET_STRATEGIES } from '../../../src/modules/strategy/app/strategy-seed.service';

describe('StrategySeed · P0-D seed 策略必须显式含 macroFit 权重', () => {
  it('PRESET_STRATEGIES 至少包含 10 套策略（V6.3 4 套 + V7.8 6 套）', () => {
    expect(PRESET_STRATEGIES.length).toBeGreaterThanOrEqual(10);
  });

  it.each([
    'precision',
    'discovery',
    'takeout_focused',
    'canteen_optimized',
    'diabetes',
    'gout',
    'vegetarian',
    'budget_conscious',
  ])('策略 %s 的 preferences 必须显式定义 macroFit（防稀释根因#2）', (name) => {
    const strategy = PRESET_STRATEGIES.find((s) => s.name === name);
    expect(strategy).toBeDefined();
    const prefs = strategy!.config.multiObjective?.preferences;
    expect(prefs).toBeDefined();
    expect(prefs!.macroFit).toBeDefined();
    expect(typeof prefs!.macroFit).toBe('number');
    expect(prefs!.macroFit).toBeGreaterThan(0);
  });

  it('所有含 preferences 的策略 macroFit 权重均 ≥ 0.25（阈值：归一化后占比不被 health+taste 稀释到 <20%）', () => {
    const violations: string[] = [];
    for (const strategy of PRESET_STRATEGIES) {
      const prefs = strategy.config.multiObjective?.preferences;
      if (!prefs) continue;
      if ((prefs.macroFit ?? 0) < 0.25) {
        violations.push(`${strategy.name}: macroFit=${prefs.macroFit}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('医疗类策略（diabetes/gout）的 macroFit 权重应相对保守（≤0.4 留出 health 主导空间）', () => {
    const medical = ['diabetes', 'gout'];
    for (const name of medical) {
      const strategy = PRESET_STRATEGIES.find((s) => s.name === name);
      const prefs = strategy?.config.multiObjective?.preferences;
      expect(prefs?.macroFit).toBeLessThanOrEqual(0.4);
    }
  });

  it('精准营养类策略（precision）macroFit 权重应相对激进（≥0.4 主导宏量达标）', () => {
    const precision = PRESET_STRATEGIES.find((s) => s.name === 'precision');
    const prefs = precision?.config.multiObjective?.preferences;
    expect(prefs?.macroFit).toBeGreaterThanOrEqual(0.4);
  });
});
