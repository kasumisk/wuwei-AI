import { translateEnum } from '../../../src/common/i18n/enum-i18n';
import { AllergenChecksService } from '../../../src/modules/decision/checks/allergen-checks.service';
import { DecisionSummaryService } from '../../../src/modules/decision/decision/decision-summary.service';

describe('decision allergen i18n', () => {
  const i18n = {
    currentLocale: jest.fn().mockReturnValue('zh-CN'),
    t: jest.fn((key: string, _locale?: string, vars?: Record<string, any>) => {
      if (key === 'decision.check.allergen') {
        return `含过敏原「${vars?.allergen}」`;
      }
      if (key === 'decision.summary.healthNote.generic') {
        return `存在健康约束（${vars?.constraints}）`;
      }
      return key;
    }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns translated allergen labels in check messages and data', () => {
    const service = new AllergenChecksService(i18n);

    const result = service.check(
      [
        {
          name: 'latte',
          calories: 120,
          protein: 6,
          fat: 4,
          carbs: 12,
          allergens: ['milk'],
        },
      ],
      { allergens: ['milk'] },
      'zh-CN',
    );

    expect(result?.triggered).toBe(true);
    expect(result?.reason).toContain('牛奶');
    expect(result?.reason).not.toContain('milk');
    expect(result?.issue?.data).toEqual({
      allergen: '牛奶',
      allergenCode: 'milk',
    });
  });

  it('covers all allergen enum and alias values used by matching', () => {
    const allergenValues = [
      'gluten',
      'wheat',
      'dairy',
      'milk',
      'lactose',
      'egg',
      'eggs',
      'fish',
      'seafood',
      'shellfish',
      'shrimp',
      'crab',
      'tree_nut',
      'tree_nuts',
      'nuts',
      'peanut',
      'peanuts',
      'soy',
      'soybeans',
      'sesame',
      'sulfites',
    ];

    for (const value of allergenValues) {
      expect(translateEnum('allergen', value, 'zh-CN')).not.toBe(value);
      expect(translateEnum('allergen', value, 'en-US')).not.toBe(value);
      expect(translateEnum('allergen', value, 'ja-JP')).not.toBe(value);
    }
  });

  it('translates allergens in health constraint summary notes', () => {
    const service = new DecisionSummaryService({} as any, i18n);
    const note = (service as any).buildHealthConstraintNote(
      {
        allergens: ['milk'],
        dietaryRestrictions: [],
        healthConditions: [],
      },
      [],
      'zh-CN',
    );

    expect(note).toContain('牛奶');
    expect(note).not.toContain('milk');
  });
});
