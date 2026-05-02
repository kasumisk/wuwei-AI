/**
 * Shared utilities for module-level recommendation runners.
 *
 * Provides:
 *  - bootstrapAppContext(): real Nest standalone application context (DB + Redis)
 *  - loadE2EUsers(): the 12 seeded e2e users with profiles
 *  - macroSplit(): MealTarget split heuristic for any goal/mealType/dailyCal
 *  - writeReport(): markdown report writer to test/runners/reports/<module>/
 */

import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/core/prisma/prisma.service';
import type { MealTarget } from '../../../src/modules/diet/app/recommendation/types/meal.types';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Scenario = 'takeout' | 'convenience' | 'homeCook';
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const SCENARIOS: Scenario[] = ['takeout', 'convenience', 'homeCook'];

export interface E2EUser {
  id: string;
  email: string;
  goal: string;
  region: string;
  locale: string;
  dailyCal: number;
  weightKg: number;
  profile: any;
}

export async function bootstrapAppContext(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
}

export async function loadE2EUsers(
  app: INestApplicationContext,
): Promise<E2EUser[]> {
  const prisma = app.get(PrismaService);
  const users = await prisma.appUsers.findMany({
    where: { email: { endsWith: '@e2e.test' } },
    include: { userProfiles: true },
    orderBy: { email: 'asc' },
  });
  return users
    .filter((u) => u.userProfiles)
    .map((u) => {
      const p = u.userProfiles!;
      return {
        id: u.id,
        email: u.email!,
        goal: p.goal,
        region: p.regionCode || 'US',
        locale: p.locale || 'en-US',
        dailyCal: p.dailyCalorieGoal || 2000,
        weightKg: p.weightKg ? Number(p.weightKg) : 70,
        profile: p,
      };
    });
}

export function macroSplit(
  dailyCal: number,
  mealType: MealType,
  goal: string,
  weightKg: number,
): { daily: MealTarget; meal: MealTarget } {
  const proteinGPerKg =
    goal === 'muscle_gain'
      ? 2.4
      : goal === 'fat_loss'
        ? 2.1
        : goal === 'habit'
          ? 2.0
          : 1.6;
  const dailyProtein = Math.round(proteinGPerKg * weightKg);
  const dailyFat = Math.round((dailyCal * 0.27) / 9);
  const dailyCarbs = Math.round(
    (dailyCal - dailyProtein * 4 - dailyFat * 9) / 4,
  );
  const daily: MealTarget = {
    calories: dailyCal,
    protein: dailyProtein,
    fat: dailyFat,
    carbs: Math.max(dailyCarbs, 0),
  };
  const ratio =
    mealType === 'breakfast'
      ? 0.25
      : mealType === 'lunch'
        ? 0.35
        : mealType === 'dinner'
          ? 0.3
          : 0.1;
  const meal: MealTarget = {
    calories: Math.round(dailyCal * ratio),
    protein: Math.round(dailyProtein * ratio),
    fat: Math.round(dailyFat * ratio),
    carbs: Math.round(daily.carbs * ratio),
  };
  return { daily, meal };
}

export interface ReportOptions {
  moduleName: string; // e.g. '01-profile-aggregator'
  title: string;
  summary: Record<string, string | number>;
  sections: Array<{ heading: string; body: string }>;
}

export function writeReport(opts: ReportOptions): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(__dirname, '..', 'reports', opts.moduleName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts}.md`);
  const lines: string[] = [];
  lines.push(`# ${opts.title}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  for (const [k, v] of Object.entries(opts.summary)) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push('');
  for (const sec of opts.sections) {
    lines.push(`## ${sec.heading}`);
    lines.push('');
    lines.push(sec.body);
    lines.push('');
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

export function shortErr(err: unknown, lines = 4): string {
  const msg =
    (err as Error)?.stack || (err as Error)?.message || String(err);
  return msg.split('\n').slice(0, lines).join(' | ');
}

export function makeLogger(name: string): Logger {
  return new Logger(name);
}
