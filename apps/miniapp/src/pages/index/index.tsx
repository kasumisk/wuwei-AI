import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, Button, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useAuthStore } from '@/store/auth';
import * as foodService from '@/services/food';
import type { DailySummary, FoodRecord, UserProfile, DailyPlan, MealSuggestion } from '@/types/api';
import './index.scss';

const mealTypeMap: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};
const mealEmoji: Record<string, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍪',
};
const mealPlanKeys = [
  { key: 'morningPlan', label: '早餐', emoji: '🌅' },
  { key: 'lunchPlan', label: '午餐', emoji: '☀️' },
  { key: 'dinnerPlan', label: '晚餐', emoji: '🌙' },
  { key: 'snackPlan', label: '加餐', emoji: '🍪' },
] as const;

// ── 根据目标给出评分标签
function getScoreLabel(score: number) {
  if (score >= 85) return { label: '优秀', color: '#16a34a' };
  if (score >= 70) return { label: '良好', color: '#2563eb' };
  if (score >= 55) return { label: '一般', color: '#d97706' };
  return { label: '需改善', color: '#dc2626' };
}

// ── 根据目标构建展示的营养维度
function buildMetrics(summary: DailySummary, goal: string) {
  const cal = summary.totalCalories || 0;
  const calGoal = summary.calorieGoal || 2000;
  const protein = Number(summary.totalProtein) || 0;
  const proteinGoal = Number(summary.proteinGoal) || 0;
  const carbs = Number(summary.totalCarbs) || 0;
  const carbsGoal = Number(summary.carbsGoal) || 0;
  const fat = Number(summary.totalFat) || 0;
  const fatGoal = Number(summary.fatGoal) || 0;
  const quality = Number(summary.avgQuality) || 0;

  const pct = (v: number, g: number) => (g > 0 ? Math.min(100, Math.round((v / g) * 100)) : 0);
  const status = (v: number, g: number, inverse = false) => {
    const r = g > 0 ? v / g : 0;
    if (inverse) return r < 0.9 ? '✅' : r < 1.1 ? '⚠️' : '🔴';
    return r < 0.7 ? '⚠️' : r <= 1.1 ? '✅' : '🔴';
  };

  if (goal === 'fat_loss')
    return [
      {
        key: 'cal',
        label: '热量',
        val: cal,
        goal: calGoal,
        unit: 'kcal',
        pct: pct(cal, calGoal),
        icon: status(cal, calGoal, true),
        weight: '最重要',
      },
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        pct: pct(protein, proteinGoal),
        icon: status(protein, proteinGoal),
        weight: '重要',
      },
      {
        key: 'carbs',
        label: '碳水',
        val: carbs,
        goal: carbsGoal,
        unit: 'g',
        pct: pct(carbs, carbsGoal),
        icon: status(carbs, carbsGoal, true),
        weight: '控制',
      },
    ];
  if (goal === 'muscle_gain')
    return [
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        pct: pct(protein, proteinGoal),
        icon: status(protein, proteinGoal),
        weight: '最重要',
      },
      {
        key: 'cal',
        label: '热量',
        val: cal,
        goal: calGoal,
        unit: 'kcal',
        pct: pct(cal, calGoal),
        icon: status(cal, calGoal),
        weight: '重要',
      },
      {
        key: 'carbs',
        label: '碳水',
        val: carbs,
        goal: carbsGoal,
        unit: 'g',
        pct: pct(carbs, carbsGoal),
        icon: status(carbs, carbsGoal),
        weight: '辅助',
      },
    ];
  // health / habit
  return [
    {
      key: 'quality',
      label: '食物质量',
      val: quality,
      goal: 10,
      unit: '分',
      pct: pct(quality, 10),
      icon: quality >= 7 ? '✅' : '⚠️',
      weight: '优先',
    },
    {
      key: 'cal',
      label: '热量均衡',
      val: cal,
      goal: calGoal,
      unit: 'kcal',
      pct: pct(cal, calGoal),
      icon: status(cal, calGoal, true),
      weight: '',
    },
    {
      key: 'fat',
      label: '脂肪',
      val: fat,
      goal: fatGoal,
      unit: 'g',
      pct: pct(fat, fatGoal),
      icon: status(fat, fatGoal, true),
      weight: '',
    },
  ];
}

function Index() {
  const { isLoggedIn, user } = useAuthStore();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [records, setRecords] = useState<FoodRecord[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [suggestion, setSuggestion] = useState<MealSuggestion | null>(null);
  const [activeScenario, setActiveScenario] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const [s, r, p, pl, sug] = await Promise.all([
        foodService.getTodaySummary(),
        foodService.getTodayRecords(),
        foodService.getProfile(),
        foodService.getDailyPlan().catch(() => null),
        foodService.getMealSuggestion().catch(() => null),
      ]);
      setSummary(s);
      setRecords(r);
      setProfile(p);
      setPlan(pl);
      setSuggestion(sug);

      // 档案未完善时跳转到引导填写页（复用已获取的 profile，避免重复请求）
      if (p && !p.onboardingCompleted) {
        Taro.redirectTo({ url: '/pages/health-profile/index?from=onboarding' });
      }
    } catch (err) {
      Taro.showToast({ title: '数据加载失败，请下拉刷新', icon: 'none', duration: 2000 });
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) Taro.reLaunch({ url: '/pages/login/index' });
  }, [isLoggedIn]);

  useDidShow(() => {
    fetchData();
  });

  if (!isLoggedIn) return null;

  // Loading 骨架屏
  if (loading) {
    return (
      <ScrollView className="idx-page" scrollY>
        <View className="idx-header">
          <View className="idx-avatar">
            <Text className="idx-avatar-text">...</Text>
          </View>
          <Text className="idx-app-name">无畏健康</Text>
        </View>
        <View className="idx-card idx-status-card" style={{ opacity: 0.5 }}>
          <View
            style={{
              height: '20px',
              width: '80px',
              background: '#e5e7eb',
              borderRadius: '4px',
              marginBottom: '12px',
            }}
          />
          <View
            style={{
              height: '32px',
              width: '140px',
              background: '#e5e7eb',
              borderRadius: '4px',
              marginBottom: '8px',
            }}
          />
          <View
            style={{ height: '8px', width: '100%', background: '#e5e7eb', borderRadius: '4px' }}
          />
        </View>
      </ScrollView>
    );
  }

  const goal = summary?.calorieGoal || 2000;
  const consumed = summary?.totalCalories || 0;
  const calPct = Math.min(100, Math.round((consumed / goal) * 100));
  const goalType = profile?.goal || 'health';
  const score = summary?.nutritionScore || 0;
  const { label: scoreLabel, color: scoreColor } = getScoreLabel(score);
  const metrics = summary ? buildMetrics(summary, goalType) : [];

  const goalLabel: Record<string, string> = {
    fat_loss: '减脂',
    muscle_gain: '增肌',
    health: '健康维持',
    habit: '改善习惯',
  };

  return (
    <ScrollView className="idx-page" scrollY>
      {/* ── Header ── */}
      <View className="idx-header">
        <View
          className="idx-avatar"
          onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}
        >
          <Text className="idx-avatar-text">{user?.nickname?.[0] || '👤'}</Text>
        </View>
        <Text className="idx-app-name">无畏健康</Text>
        <View onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}>
          <Text className="idx-settings">⚙️</Text>
        </View>
      </View>

      {/* ── 今日状态卡片 ── */}
      <View className="idx-card idx-status-card">
        <View className="idx-status-top">
          <Text className="idx-status-label">🎯 今日状态</Text>
          {score > 0 && (
            <View className="idx-score-badge" style={{ borderColor: scoreColor }}>
              <Text className="idx-score-num" style={{ color: scoreColor }}>
                {score}
              </Text>
              <Text className="idx-score-unit" style={{ color: scoreColor }}>
                分
              </Text>
              <Text className="idx-score-tag" style={{ color: scoreColor }}>
                {scoreLabel}
              </Text>
            </View>
          )}
        </View>

        {/* 热量进度 */}
        <View className="idx-cal-row">
          <Text className="idx-cal-consumed">{consumed.toLocaleString()}</Text>
          <Text className="idx-cal-sep"> / </Text>
          <Text className="idx-cal-goal">{goal.toLocaleString()} kcal</Text>
        </View>
        <View className="idx-prog-track">
          <View className="idx-prog-fill" style={{ width: `${calPct}%` }} />
        </View>
        <View className="idx-cal-footer">
          <Text className="idx-cal-sub">已摄入 {consumed} kcal</Text>
          <Text className="idx-cal-sub">已记录 {summary?.mealCount || 0} 餐</Text>
        </View>

        {/* 目标维度指标 */}
        {metrics.length > 0 && (
          <View className="idx-metrics">
            <Text className="idx-metrics-title">
              {goalType === 'fat_loss'
                ? '🔥 减脂'
                : goalType === 'muscle_gain'
                  ? '💪 增肌'
                  : '🧘 ' + (goalLabel[goalType] || '健康')}
              用户关注
            </Text>
            {metrics.map((m) => (
              <View key={m.key} className="idx-metric-row">
                <View className="idx-metric-left">
                  <Text className="idx-metric-icon">{m.icon}</Text>
                  <Text className="idx-metric-name">{m.label}</Text>
                  {m.weight ? <Text className="idx-metric-weight">{m.weight}</Text> : null}
                </View>
                <View className="idx-metric-right">
                  <View className="idx-metric-bar-track">
                    <View
                      className="idx-metric-bar-fill"
                      style={{
                        width: `${m.pct}%`,
                        background: m.pct > 100 ? '#ef4444' : '#16a34a',
                      }}
                    />
                  </View>
                  <Text className="idx-metric-val">
                    {Math.round(m.val)}
                    <Text className="idx-metric-unit">
                      /{Math.round(m.goal)}
                      {m.unit}
                    </Text>
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── CTA 按钮 ── */}
      <View className="idx-cta-row">
        <View
          className="idx-cta-main"
          onClick={() => Taro.switchTab({ url: '/pages/analyze/index' })}
        >
          <Text className="idx-cta-icon">📷</Text>
          <Text className="idx-cta-text">拍照识别</Text>
        </View>
        <View
          className="idx-cta-sub"
          onClick={() => Taro.navigateTo({ url: '/pages/foods/index' })}
        >
          <Text className="idx-cta-icon">🔍</Text>
          <Text className="idx-cta-text">手动搜索</Text>
        </View>
      </View>

      {/* ── 今日饮食计划 ── */}
      {plan && (
        <View className="idx-card">
          <View className="idx-section-header">
            <Text className="idx-section-emoji">📅</Text>
            <Text className="idx-section-title">今日饮食计划</Text>
            <Text className="idx-section-date">{new Date().getDate()}日</Text>
          </View>
          {plan.strategy && (
            <View className="idx-strategy">
              <Text className="idx-strategy-icon">💡</Text>
              <Text className="idx-strategy-text">{plan.strategy}</Text>
            </View>
          )}
          <View className="idx-meal-grid">
            {mealPlanKeys.map(({ key, label, emoji }) => {
              const mp = (plan as any)[key];
              if (!mp) return null;
              const foods = mp.foods || '';
              const preview = foods.length > 20 ? foods.slice(0, 20) + '...' : foods;
              return (
                <View key={key} className="idx-meal-card">
                  <View className="idx-meal-card-header">
                    <Text className="idx-meal-emoji">{emoji}</Text>
                    <Text className="idx-meal-label">{label}</Text>
                  </View>
                  <Text className="idx-meal-foods">{preview}</Text>
                  <Text className="idx-meal-kcal">{mp.calories} kcal</Text>
                  {mp.tip && <Text className="idx-meal-tip">{mp.tip}</Text>}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── 下一餐推荐 ── */}
      {suggestion && (
        <View className="idx-card">
          <View className="idx-section-header">
            <Text className="idx-section-emoji">🍽️</Text>
            <Text className="idx-section-title">下一餐推荐</Text>
            <Text className="idx-section-sub">还剩 {suggestion.remainingCalories} kcal</Text>
          </View>

          {/* 场景 tabs */}
          {suggestion.scenarios && suggestion.scenarios.length > 0 && (
            <>
              <View className="idx-tab-row">
                {suggestion.scenarios.map((s, i) => (
                  <View
                    key={i}
                    className={`idx-tab ${activeScenario === i ? 'idx-tab--on' : ''}`}
                    onClick={() => setActiveScenario(i)}
                  >
                    <Text>{s.scenario}</Text>
                  </View>
                ))}
              </View>
              {(() => {
                const s = suggestion.scenarios[activeScenario];
                return s ? (
                  <View className="idx-scenario-card">
                    <Text className="idx-scenario-foods">{s.foods}</Text>
                    <Text className="idx-scenario-cal">约 {s.calories} kcal</Text>
                    <Text className="idx-scenario-tip">{s.tip}</Text>
                  </View>
                ) : null;
              })()}
            </>
          )}

          {/* 无场景时显示通用推荐 */}
          {(!suggestion.scenarios || suggestion.scenarios.length === 0) && (
            <View className="idx-scenario-card">
              <Text className="idx-scenario-foods">{suggestion.suggestion.foods}</Text>
              <Text className="idx-scenario-cal">约 {suggestion.suggestion.calories} kcal</Text>
              <Text className="idx-scenario-tip">{suggestion.suggestion.tip}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── 今日记录 ── */}
      {records.length > 0 && (
        <View className="idx-card">
          <Text className="idx-section-title" style={{ marginBottom: '12px' }}>
            今日饮食记录
          </Text>
          {records.map((r) => (
            <View className="idx-record-row" key={r.id}>
              <View className="idx-record-img">
                {r.imageUrl ? (
                  <Image className="idx-record-thumb" src={r.imageUrl} mode="aspectFill" />
                ) : (
                  <View className="idx-record-thumb idx-record-thumb--empty">
                    <Text className="idx-record-thumb-emoji">{mealEmoji[r.mealType] || '🍽️'}</Text>
                  </View>
                )}
              </View>
              <View className="idx-record-info">
                <Text className="idx-record-name">
                  {r.foods?.map((f) => f.name).join('、') || '未知食物'}
                </Text>
                <Text className="idx-record-meta">
                  {mealTypeMap[r.mealType] || r.mealType}
                  {r.isHealthy != null && (r.isHealthy ? ' · 🟢 健康' : ' · 🟡 偏高')}
                </Text>
              </View>
              <View className="idx-record-cal">
                <Text className="idx-record-kcal">{r.totalCalories}</Text>
                <Text className="idx-record-unit">kcal</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {records.length === 0 && !plan && (
        <View className="idx-empty">
          <Text className="idx-empty-text">还没有记录，快去拍照记录吧 🍽️</Text>
        </View>
      )}

      <View style={{ height: '24px' }} />
    </ScrollView>
  );
}

export default Index;
