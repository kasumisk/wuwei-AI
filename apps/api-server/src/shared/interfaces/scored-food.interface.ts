export interface ScoredFood {
  food: any;
  score: number;
  dimensions: Record<string, number>;
  penalties: PenaltyResult[];
  servingG?: number;
  servingCalories?: number;
}

export interface PenaltyResult {
  rule: string;
  penalty: number;
  description: string;
}
