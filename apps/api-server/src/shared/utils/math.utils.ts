/**
 * 高斯钟形函数
 * 在 actual == target 时返回 maxScore, 偏离越大分数越低
 */
export function gaussian(actual: number, target: number, sigma: number, maxScore = 100): number {
  if (sigma <= 0) return maxScore;
  return maxScore * Math.exp(-Math.pow(actual - target, 2) / (2 * sigma * sigma));
}

/**
 * Sigmoid 函数 (用于 GL 评分)
 * 值越大分数越低
 */
export function sigmoid(x: number, midpoint: number, steepness: number): number {
  return 100 / (1 + Math.exp(steepness * (x - midpoint)));
}

/**
 * Beta 分布采样 (用于 Thompson Sampling 探索)
 * 使用 Jöhnk's algorithm 近似
 */
export function betaSample(alpha: number, beta: number): number {
  const gammaAlpha = gammaVariate(alpha);
  const gammaBeta = gammaVariate(beta);
  return gammaAlpha / (gammaAlpha + gammaBeta);
}

/**
 * Gamma 分布采样 (辅助函数)
 * Marsaglia-Tsang method
 */
function gammaVariate(shape: number): number {
  if (shape < 1) {
    return gammaVariate(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = normalRandom();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Box-Muller 正态分布随机数
 */
function normalRandom(): number {
  const u = Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 线性插值
 * value 从 [min,max] 映射到 [fromScore,toScore]，clamp到 [0,100]
 */
export function linearScore(value: number, min: number, max: number, fromScore = 0, toScore = 100): number {
  if (max <= min) return (fromScore + toScore) / 2;
  const t = (value - min) / (max - min);
  const score = fromScore + t * (toScore - fromScore);
  return Math.max(0, Math.min(100, score));
}

/**
 * 归一化权重向量使其和为 1
 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((acc, v) => acc + v, 0);
  if (sum === 0) return weights;
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(weights)) {
    result[key] = val / sum;
  }
  return result;
}
