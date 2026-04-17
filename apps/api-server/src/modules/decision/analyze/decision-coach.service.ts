import { Injectable } from '@nestjs/common';
import { ContextualAnalysis, NutritionIssue } from '../types/analysis-result.types';

/**
 * V3.2 Phase 2 - DecisionCoachService
 * 
 * Consumes ContextualAnalysis from Phase 1 and generates personalized coaching
 * explanations, education content, and decision guidance
 */
@Injectable()
export class DecisionCoachService {
  constructor() {}

  /**
   * Generate comprehensive coaching explanation for a decision
   * 
   * @param analysis - Complete analysis output from Phase 1
   * @param userId - User ID for personalization
   * @param locale - User's language preference
   * @returns Coaching explanation with education and guidance
   */
  generateCoachingExplanation(
    analysis: ContextualAnalysis,
    userId?: string,
    locale?: string,
  ): CoachingExplanation {
    const headline = this.generateHeadline(analysis);
    const summary = this.generateSummary(analysis);
    const issueExplanations = this.generateIssueExplanations(analysis);
    const guidance = this.generateGuidance(analysis);
    const educationPoints = this.generateEducationPoints(analysis);

    return {
      headline,
      summary,
      issues: issueExplanations,
      guidance,
      educationPoints,
    };
  }

  private generateHeadline(analysis: ContextualAnalysis): string {
    if (!analysis.identifiedIssues || analysis.identifiedIssues.length === 0) {
      return 'You\'re maintaining a balanced macronutrient intake!';
    }

    const highSeverityIssues = analysis.identifiedIssues.filter(
      (issue) => issue.severity === 'high',
    );

    if (highSeverityIssues.length === 0) {
      return 'Minor nutrition adjustments needed today.';
    }

    const mainIssue = highSeverityIssues[0];
    const headlines: { [key: string]: string } = {
      protein_deficit: 'Time to boost your protein intake!',
      carb_excess: 'Consider lighter carbs for your next meal.',
      sodium_excess: 'Watch your sodium intake today.',
      fiber_deficit: 'Add more fiber-rich foods to your diet.',
      sugar_excess: 'Time to reduce added sugars.',
      fat_excess: 'Consider lower-fat options.',
      calorie_excess: 'You\'re nearing your daily calorie target.',
    };

    return headlines[mainIssue.type] || 'Make adjustments to your nutrition plan.';
  }

  private generateSummary(analysis: ContextualAnalysis): string {
    const slots = analysis?.macroSlotStatus;

    if (!slots) {
      return 'macronutrient analysis unavailable.';
    }

    const proteinStatus = `Protein: ${slots.protein}`;
    const carbStatus = `Carbs: ${slots.carbs}`;
    const fatStatus = `Fat: ${slots.fat}`;

    return `Current macronutrient status: ${proteinStatus}, ${carbStatus}, ${fatStatus}. Issues detected: ${analysis.identifiedIssues?.length || 0}.`;
  }

  private generateIssueExplanations(
    analysis: ContextualAnalysis,
  ): IssueExplanation[] {
    if (!analysis.identifiedIssues) {
      return [];
    }

    return analysis.identifiedIssues
      .sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      })
      .map((issue) => ({
        type: issue.type,
        severity: issue.severity as 'high' | 'medium' | 'low',
        explanation: this.explainIssue(issue),
        actionable: this.generateAction(issue),
      }));
  }

  private explainIssue(issue: NutritionIssue): string {
    const explanations: { [key: string]: string } = {
      protein_deficit: `Your protein intake is below target. Deficit: ${issue.metric}g (Threshold: ${issue.threshold}g).`,
      carb_excess: `Your carbohydrate intake exceeds the recommended amount. Excess: ${issue.metric}g (Threshold: ${issue.threshold}g max).`,
      sodium_excess: `Your sodium intake is higher than recommended. Excess: ${issue.metric}mg (Threshold: ${issue.threshold}mg).`,
      fiber_deficit: `Your fiber intake is insufficient. Deficit: ${issue.metric}g (Threshold: ${issue.threshold}g).`,
      sugar_excess: `Added sugar exceeds recommended levels. Excess: ${issue.metric}g (Threshold: ${issue.threshold}g max).`,
      fat_excess: `Fat intake is above target. Excess: ${issue.metric}g (Threshold: ${issue.threshold}g).`,
      calorie_excess: `You are approaching or exceeding your daily calorie limit. Excess: ${issue.metric}kcal.`,
    };

    return (
      explanations[issue.type] ||
      `${issue.type}: ${issue.implication}`
    );
  }

  private generateAction(issue: NutritionIssue): string {
    const actions: { [key: string]: string } = {
      protein_deficit: `Add 20-30g of protein from chicken, fish, dairy, or legumes.`,
      carb_excess: `Choose lower-carb alternatives or reduce portion sizes.`,
      sodium_excess: `Limit processed foods and use less salt in cooking.`,
      fiber_deficit: `Eat more vegetables, whole grains, and legumes.`,
      sugar_excess: `Avoid sugary drinks and processed snacks.`,
      fat_excess: `Choose lean proteins and reduce cooking oils.`,
      calorie_excess: `Watch portion sizes or choose lower-calorie alternatives.`,
    };

    return (
      actions[issue.type] || `Address ${issue.type} by making dietary adjustments.`
    );
  }

  private generateGuidance(analysis: ContextualAnalysis): string {
    let guidance =
      'To maintain balanced nutrition, focus on consistent meal planning. ';

    const slots = analysis?.macroSlotStatus;

    if (!slots) {
      return guidance + 'Track your intake and adjust portions based on how you feel.';
    }

    if (slots.protein === 'deficit') {
      guidance += 'Prioritize protein-rich foods at each meal. ';
    }

    if (slots.carbs === 'excess') {
      guidance += 'Consider lower-carb meals or smaller portions. ';
    }

    if (slots.fat === 'excess') {
      guidance += 'Choose healthier fats and reduce saturated fats. ';
    }

    guidance +=
      'Track your intake and adjust portions based on how you feel.';

    return guidance;
  }

  private generateEducationPoints(
    analysis: ContextualAnalysis,
  ): EducationPoint[] {
    const points: EducationPoint[] = [];

    if (
      analysis.identifiedIssues?.some((i) => i.type === 'protein_deficit')
    ) {
      points.push({
        topic: 'Protein Importance',
        why: 'Protein is essential for muscle repair, strength, and satiety. Adequate intake prevents muscle breakdown and supports recovery.',
        howToFix:
          'Include lean protein sources like chicken, fish, tofu, eggs, dairy, and legumes in every meal. Aim for 25-30g per meal.',
      });
    }

    if (analysis.identifiedIssues?.some((i) => i.type === 'fiber_deficit')) {
      points.push({
        topic: 'Fiber Benefits',
        why: 'Fiber supports digestive health, stabilizes blood sugar, and promotes lasting satiety. It also supports overall cardiovascular health.',
        howToFix:
          'Add vegetables, fruits, whole grains, beans, and seeds to your meals. Increase fiber gradually to avoid digestive discomfort.',
      });
    }

    if (analysis.identifiedIssues?.some((i) => i.type === 'sugar_excess')) {
      points.push({
        topic: 'Sugar Management',
        why: 'Excess sugar can lead to energy crashes, weight gain, and increased risk of metabolic diseases. Controlling sugar intake improves sustained energy and dental health.',
        howToFix:
          'Read labels, choose whole fruits instead of juices, limit desserts, and use natural sweeteners sparingly.',
      });
    }

    if (!points.length) {
      points.push({
        topic: 'Balanced Nutrition',
        why: 'Balanced macronutrients support sustained energy, muscle maintenance, and overall health. Each macronutrient plays a unique role.',
        howToFix:
          'Continue monitoring your intake and maintaining consistent meal patterns that work for your lifestyle.',
      });
    }

    return points;
  }
}

/**
 * Coaching explanation output type
 */
export interface CoachingExplanation {
  headline: string;
  summary: string;
  issues: IssueExplanation[];
  guidance: string;
  educationPoints: EducationPoint[];
}

/**
 * Individual issue explanation
 */
export interface IssueExplanation {
  type: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  actionable: string;
}

/**
 * Educational content about a nutrition topic
 */
export interface EducationPoint {
  topic: string;
  why: string;
  howToFix: string;
}
