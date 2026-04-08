export interface WeightVector {
  calorieEfficiency: number;
  macroBalance: number;
  nutrientDensity: number;
  satiety: number;
  quality: number;
  processingPenalty: number;
  glycemicControl: number;
  inflammationIndex: number;
  diversity: number;
  budgetFit: number;
  [key: string]: number;
}
