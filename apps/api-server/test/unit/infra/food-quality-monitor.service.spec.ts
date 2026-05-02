import { FoodQualityMonitorService } from '../../../src/food-pipeline/services/food-quality-monitor.service';

describe('FoodQualityMonitorService', () => {
  let prisma: any;
  let service: FoodQualityMonitorService;

  beforeEach(() => {
    prisma = {
      food: { count: jest.fn().mockResolvedValue(120) },
      foodConflicts: { count: jest.fn() },
      foodTranslations: { count: jest.fn() },
      foodChangeLogs: { count: jest.fn() },
      $queryRaw: jest.fn(),
    };
    service = new FoodQualityMonitorService(prisma);
  });

  it('getCompleteness 应从 split tables 聚合 taxonomy 和 health 字段', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        total: 120,
        with_protein: 100,
        with_micro: 88,
        with_gi: 72,
        with_allergens: 65,
        with_compatibility: 54,
        with_tags: 91,
        with_image: 40,
      },
    ]);

    const result = await (service as any).getCompleteness();
    const sql = (prisma.$queryRaw.mock.calls[0][0] as any).strings.join(' ');

    expect(sql).toContain('LEFT JOIN food_nutrition_details nd');
    expect(sql).toContain('LEFT JOIN food_health_assessments ha');
    expect(sql).toContain('LEFT JOIN food_taxonomies tx');
    expect(result).toEqual({
      total: 120,
      withProtein: 100,
      withMicronutrients: 88,
      withGI: 72,
      withAllergens: 65,
      withCompatibility: 54,
      withTags: 91,
      withImage: 40,
    });
  });

  it('getFieldCompleteness 应从 nutrition 和 health split tables 读取拆分字段', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        total: 10,
        protein: 9,
        fat: 8,
        carbs: 7,
        fiber: 6,
        sugar: 5,
        sodium: 4,
        calcium: 3,
        iron: 2,
        potassium: 1,
        vitamin_a: 9,
        vitamin_c: 8,
        vitamin_d: 7,
        vitamin_e: 6,
        vitamin_b12: 5,
        folate: 4,
        zinc: 3,
        magnesium: 2,
        phosphorus: 1,
        glycemic_index: 7,
        glycemic_load: 6,
        saturated_fat: 5,
        trans_fat: 4,
        cholesterol: 3,
      },
    ]);

    const result = await (service as any).getFieldCompleteness();
    const sql = (prisma.$queryRaw.mock.calls[0][0] as any).strings.join(' ');

    expect(sql).toContain('COUNT(nd.vitamin_a)::int AS vitamin_a');
    expect(sql).toContain('COUNT(ha.glycemic_index)::int AS glycemic_index');
    expect(sql).toContain('LEFT JOIN food_nutrition_details nd');
    expect(sql).toContain('LEFT JOIN food_health_assessments ha');
    expect(result.find((item: any) => item.field === 'vitamin_a')).toMatchObject({
      filledCount: 9,
      totalCount: 10,
      percentage: 90,
    });
    expect(result.find((item: any) => item.field === 'glycemic_index')).toMatchObject({
      filledCount: 7,
      totalCount: 10,
      percentage: 70,
    });
  });
});
