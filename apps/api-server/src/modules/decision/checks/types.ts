/**
 * Decision Checks 共享类型
 *
 * V13.4: 从 config/decision-checks.ts 抽取，保留为 types-only 文件。
 * 所有 checks/*.service.ts 与外部 caller (food-decision.service 等) 统一从这里 import。
 */
import { DietIssue } from '../types/analysis-result.types';

// ==================== 输出类型 ====================

export interface CheckResult {
  /** 是否触发 */
  triggered: boolean;
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 如果需要覆盖决策（仅 allergen/restriction 使用） */
  decisionOverride?: 'avoid' | 'caution';
  /** 对应的 DietIssue */
  issue?: DietIssue;
  /** 上下文原因文本（追加到 contextReasons） */
  reason?: string;
}

// ==================== 食物项最小接口 ====================

export interface CheckableFoodItem {
  name: string;
  category?: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sodium?: number;
  addedSugar?: number | null;
  /** 食物库过敏原字段（优先用于过敏原判断，无此字段时退化到名称关键字匹配） */
  allergens?: string[];
  // ── 健康状况检查所需扩展字段 ──
  /** 饱和脂肪 (g/100g) */
  saturatedFat?: number | null;
  /** 嘌呤 (mg/100g) — 数值型，旧路径 */
  purine?: number | null;
  /** 钾 (mg/100g) */
  potassium?: number | null;
  /** 磷 (mg/100g) */
  phosphorus?: number | null;
  /** 膳食纤维 (g/100g) */
  fiber?: number | null;
  /** 钙 (mg/100g) */
  calcium?: number | null;
  /** 铁 (mg/100g) */
  iron?: number | null;
  /** 血糖指数 */
  glycemicIndex?: number | null;
  /** FODMAP 等级: 'low' | 'medium' | 'high' */
  fodmapLevel?: 'low' | 'medium' | 'high' | null;
  /** 食物标签数组 */
  tags?: string[];

  // ── V4.6: 新增风险标记字段 ──
  /** V4.6: 反式脂肪 (g) */
  transFat?: number | null;
  /** V4.6: 胆固醇 (mg) */
  cholesterol?: number | null;
  /** V4.6: 草酸等级（肾结石风险） */
  oxalateLevel?: 'low' | 'medium' | 'high' | null;
  /** V4.6: 嘌呤等级（痛风风险，V4.6 枚举型，优先于数值型 purine） */
  purineLevel?: 'low' | 'medium' | 'high' | null;
  /** V4.6: 血糖负荷 */
  glycemicLoad?: number | null;
}
