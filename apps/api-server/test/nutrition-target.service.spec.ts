/**
 * V7.8 P3: NutritionTargetService 单元测试
 */
import { NutritionTargetService } from '../src/modules/diet/app/recommendation/nutrition-target.service';
import { HealthCondition } from '../src/modules/diet/app/recommendation/recommendation.types';

describe('NutritionTargetService', () => {
  let service: NutritionTargetService;

  beforeEach(() => {
    service = new NutritionTargetService();
  });

  // ════════════════════════════════════════════════════════════
  // Default / no-profile calculation
  // ════════════════════════════════════════════════════════════

  describe('calculate — defaults', () => {
    it('should return FDA-standard values when no profile provided', () => {
      const result = service.calculate(null);

      // defaults: male, 30 years, 65kg, health goal
      expect(result.protein).toBeGreaterThanOrEqual(50);
      expect(result.fiber).toBe(38); // male base
      expect(result.vitaminA).toBe(800); // male, <50
      expect(result.vitaminC).toBe(90); // male
      expect(result.calcium).toBe(800); // 18-49
      expect(result.iron).toBe(12); // male
      expect(result.potassium).toBe(3500);
      expect(result.vitaminD).toBe(10); // <65
      expect(result.vitaminE).toBe(14);
      expect(result.saturatedFatLimit).toBe(20);
      expect(result.addedSugarLimit).toBe(50);
      expect(result.sodiumLimit).toBe(2300);
      // V7.3
      expect(result.zinc).toBe(12.5); // male
      expect(result.magnesium).toBe(400); // male
      expect(result.transFatLimit).toBe(2.2);
    });

    it('should return defaults when called with undefined', () => {
      const result = service.calculate(undefined);
      expect(result.fiber).toBe(38);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Gender-specific values
  // ════════════════════════════════════════════════════════════

  describe('calculate — gender differences', () => {
    it('should return lower fiber for female', () => {
      const result = service.calculate({ gender: 'female', age: 30 });
      expect(result.fiber).toBe(25); // female base
    });

    it('should return higher iron for premenopausal female', () => {
      const result = service.calculate({ gender: 'female', age: 35 });
      expect(result.iron).toBe(20); // 育龄女性
    });

    it('should return lower iron for postmenopausal female', () => {
      const result = service.calculate({ gender: 'female', age: 55 });
      expect(result.iron).toBe(12); // 绝经后
    });

    it('should return female zinc and magnesium', () => {
      const result = service.calculate({ gender: 'female', age: 30 });
      expect(result.zinc).toBe(7.5);
      expect(result.magnesium).toBe(330);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Age-specific values
  // ════════════════════════════════════════════════════════════

  describe('calculate — age adjustments', () => {
    it('should reduce fiber by 10% for age >= 50', () => {
      const result = service.calculate({ gender: 'male', age: 55 });
      expect(result.fiber).toBe(Math.round(38 * 0.9)); // 34
    });

    it('should reduce vitaminA by 5% for age >= 50', () => {
      const result = service.calculate({ gender: 'male', age: 55 });
      expect(result.vitaminA).toBe(Math.round(800 * 0.95)); // 760
    });

    it('should increase calcium for age >= 50', () => {
      const result = service.calculate({ gender: 'male', age: 55 });
      expect(result.calcium).toBe(1000);
    });

    it('should return highest calcium for teens', () => {
      const result = service.calculate({ gender: 'male', age: 15 });
      expect(result.calcium).toBe(1300);
    });

    it('should increase vitaminD for age >= 65', () => {
      const result = service.calculate({ gender: 'male', age: 70 });
      expect(result.vitaminD).toBe(15);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Goal-specific protein
  // ════════════════════════════════════════════════════════════

  describe('calculate — goal-based protein', () => {
    it('should calculate health protein at 0.8 g/kg', () => {
      const result = service.calculate({
        goal: 'health',
        weightKg: 75,
      });
      expect(result.protein).toBe(60); // 75 * 0.8 = 60
    });

    it('should calculate fat_loss protein at 1.2 g/kg', () => {
      const result = service.calculate({
        goal: 'fat_loss',
        weightKg: 80,
      });
      expect(result.protein).toBe(96); // 80 * 1.2 = 96
    });

    it('should calculate muscle_gain protein at 1.6 g/kg', () => {
      const result = service.calculate({
        goal: 'muscle_gain',
        weightKg: 70,
      });
      expect(result.protein).toBe(112); // 70 * 1.6 = 112
    });

    it('should enforce minimum 50g protein (FDA DV)', () => {
      const result = service.calculate({
        goal: 'health',
        weightKg: 40, // 40 * 0.8 = 32 → clamped to 50
      });
      expect(result.protein).toBe(50);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Health condition adjustments
  // ════════════════════════════════════════════════════════════

  describe('calculate — health condition adjustments', () => {
    it('should restrict sodium and increase potassium for hypertension', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.HYPERTENSION],
      });
      expect(result.sodiumLimit).toBeLessThanOrEqual(1500);
      expect(result.potassium).toBeGreaterThanOrEqual(4700);
      expect(result.nrf13_5Enabled).toBe(true);
      expect(result.omega3).toBeGreaterThanOrEqual(1600);
    });

    it('should restrict sugar and increase fiber for diabetes', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.DIABETES_TYPE2],
      });
      expect(result.addedSugarLimit).toBeLessThanOrEqual(25);
      expect(result.fiber).toBeGreaterThanOrEqual(30);
    });

    it('should restrict potassium and protein for kidney disease', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.KIDNEY_DISEASE],
      });
      expect(result.potassium).toBeLessThanOrEqual(2000);
      expect(result.protein).toBeLessThanOrEqual(60);
    });

    it('should increase calcium and vitaminD for osteoporosis', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.OSTEOPOROSIS],
      });
      expect(result.calcium).toBeGreaterThanOrEqual(1200);
      expect(result.vitaminD).toBeGreaterThanOrEqual(15);
    });

    it('should increase iron and vitaminC for anemia', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.IRON_DEFICIENCY_ANEMIA],
      });
      expect(result.iron).toBeGreaterThanOrEqual(25);
      expect(result.vitaminC).toBeGreaterThanOrEqual(120);
    });

    it('should restrict saturated fat and trans fat for hyperlipidemia', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.HYPERLIPIDEMIA],
      });
      expect(result.saturatedFatLimit).toBeLessThanOrEqual(13);
      expect(result.transFatLimit).toBe(0);
      expect(result.fiber).toBeGreaterThanOrEqual(30);
      expect(result.nrf13_5Enabled).toBe(true);
      expect(result.omega3).toBeGreaterThanOrEqual(2000);
      expect(result.solubleFiber).toBeGreaterThanOrEqual(10);
    });

    it('should restrict sugar and saturated fat for fatty liver', () => {
      const result = service.calculate({
        healthConditions: [HealthCondition.FATTY_LIVER],
      });
      expect(result.addedSugarLimit).toBeLessThanOrEqual(25);
      expect(result.saturatedFatLimit).toBeLessThanOrEqual(15);
      expect(result.transFatLimit).toBe(0);
      expect(result.nrf13_5Enabled).toBe(true);
    });

    it('should handle multiple conditions — most restrictive wins', () => {
      const result = service.calculate({
        healthConditions: [
          HealthCondition.HYPERTENSION,
          HealthCondition.KIDNEY_DISEASE,
        ],
      });
      // Hypertension wants potassium >= 4700
      // Kidney disease wants potassium <= 2000
      // Kidney disease runs after, so 2000 wins
      expect(result.potassium).toBeLessThanOrEqual(2000);
      // Sodium still restricted by hypertension
      expect(result.sodiumLimit).toBeLessThanOrEqual(1500);
    });
  });

  // ════════════════════════════════════════════════════════════
  // NRF13.5 enablement
  // ════════════════════════════════════════════════════════════

  describe('shouldEnableNrf13_5', () => {
    it('should enable for hyperlipidemia', () => {
      expect(
        service.shouldEnableNrf13_5([HealthCondition.HYPERLIPIDEMIA]),
      ).toBe(true);
    });

    it('should enable for hypertension', () => {
      expect(service.shouldEnableNrf13_5([HealthCondition.HYPERTENSION])).toBe(
        true,
      );
    });

    it('should enable for fatty liver', () => {
      expect(service.shouldEnableNrf13_5([HealthCondition.FATTY_LIVER])).toBe(
        true,
      );
    });

    it('should NOT enable for diabetes alone', () => {
      expect(
        service.shouldEnableNrf13_5([HealthCondition.DIABETES_TYPE2]),
      ).toBe(false);
    });

    it('should NOT enable for empty conditions', () => {
      expect(service.shouldEnableNrf13_5([])).toBe(false);
    });

    it('should enable when at least one cardiovascular condition exists', () => {
      expect(
        service.shouldEnableNrf13_5([
          HealthCondition.DIABETES_TYPE2,
          HealthCondition.FATTY_LIVER,
        ]),
      ).toBe(true);
    });
  });
});
