/**
 * V7.2: Scoring Chain barrel export
 */
export { ScoringChainService } from './scoring-chain.service';
export type {
  ScoringFactor,
  ScoringAdjustment,
  ScoringChainResult,
  ScoringChainConfig,
} from './scoring-factor.interface';
export { DEFAULT_SCORING_CHAIN_CONFIG } from './scoring-factor.interface';
export * from './factors';
