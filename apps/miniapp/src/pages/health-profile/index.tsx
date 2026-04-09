import React, { useState } from 'react';
import { View, Text, Input, Button, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import * as foodService from '@/services/food';
import type { UserProfile } from '@/types/api';
import './index.scss';

const activityOptions = [
  { key: 'sedentary', label: '久坐不动（办公室工作）' },
  { key: 'light', label: '轻度活动（偶尔散步）' },
  { key: 'moderate', label: '中度活动（每周运动 3-5 次）' },
  { key: 'active', label: '高强度（每天运动）' },
];

const goalOptions = [
  { key: 'fat_loss', label: '🔥 减脂', desc: '减少体脂，塑造体型' },
  { key: 'muscle_gain', label: '💪 增肌', desc: '增加肌肉量，提升力量' },
  { key: 'health', label: '🧘 保持健康', desc: '维持健康体重和状态' },
  { key: 'habit', label: '🌱 改善习惯', desc: '养成规律饮食的好习惯' },
];

const goalSpeedOptions = [
  { key: 'aggressive', label: '激进', desc: '快速见效' },
  { key: 'steady', label: '稳定', desc: '推荐' },
  { key: 'relaxed', label: '佛系', desc: '慢慢来' },
];

const disciplineOptions = [
  { key: 'high', label: '很强' },
  { key: 'medium', label: '一般' },
  { key: 'low', label: '容易放弃' },
];

const mealsOptions = [2, 3, 4, 5];

const takeoutOptions = [
  { key: 'never', label: '很少' },
  { key: 'sometimes', label: '偶尔' },
  { key: 'often', label: '经常' },
];

const preferenceChips = [
  { key: 'sweet', label: '甜食' },
  { key: 'fried', label: '油炸' },
  { key: 'carbs', label: '碳水' },
  { key: 'meat', label: '肉类' },
  { key: 'spicy', label: '辛辣' },
];

const restrictionChips = [
  { key: 'no_beef', label: '不吃牛肉' },
  { key: 'vegetarian', label: '素食' },
  { key: 'lactose_free', label: '乳糖不耐' },
  { key: 'halal', label: '清真' },
];

const weakSlotChips = [
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '傍晚' },
  { key: 'midnight', label: '深夜' },
];

function HealthProfilePage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Partial<UserProfile>>({
    gender: 'male',
    activityLevel: 'light',
    goal: 'health',
    goalSpeed: 'steady',
    mealsPerDay: 3,
    takeoutFrequency: 'sometimes',
    canCook: true,
    foodPreferences: [],
    dietaryRestrictions: [],
    weakTimeSlots: [],
    discipline: 'medium',
  });

  // 是否是引导模式（首次填写）
  const router = Taro.getCurrentInstance().router;
  const isOnboarding = router?.params?.from === 'onboarding';

  useDidShow(() => {
    loadProfile();
  });

  const loadProfile = async () => {
    setLoading(true);
    try {
      const p = await foodService.getProfile();
      if (p) {
        setProfile({
          gender: 'male',
          activityLevel: 'light',
          goal: 'health',
          goalSpeed: 'steady',
          mealsPerDay: 3,
          takeoutFrequency: 'sometimes',
          canCook: true,
          foodPreferences: [],
          dietaryRestrictions: [],
          weakTimeSlots: [],
          discipline: 'medium',
          ...p,
        });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // 验证必填项
    if (!profile.heightCm || !profile.weightKg || !profile.birthYear) {
      Taro.showToast({ title: '请填写身高、体重和出生年份', icon: 'none' });
      return;
    }
    setSaving(true);
    try {
      const updated = await foodService.saveProfile({
        ...profile,
        onboardingCompleted: true,
      });
      setProfile((prev) => ({ ...prev, ...updated }));
      Taro.showToast({ title: '保存成功', icon: 'success' });

      if (isOnboarding) {
        // 首次引导完成 → 跳转首页
        setTimeout(() => {
          Taro.switchTab({ url: '/pages/index/index' });
        }, 800);
      } else {
        // 编辑模式 → 返回
        setTimeout(() => {
          Taro.navigateBack();
        }, 800);
      }
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const up = (key: keyof UserProfile, value: any) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const toggleChip = (key: keyof UserProfile, val: string) => {
    const arr: string[] = (profile[key] as string[]) || [];
    up(key, arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  };

  const Chips = ({
    field,
    opts,
  }: {
    field: keyof UserProfile;
    opts: { key: string; label: string }[];
  }) => (
    <View className="pf-chips">
      {opts.map((o) => {
        const active = ((profile[field] as string[]) || []).includes(o.key);
        return (
          <View
            key={o.key}
            className={`pf-chip ${active ? 'pf-chip--on' : ''}`}
            onClick={() => toggleChip(field, o.key)}
          >
            <Text>{o.label}</Text>
          </View>
        );
      })}
    </View>
  );

  if (loading) {
    return (
      <View className="pf-loading">
        <Text className="pf-loading-text">加载中...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="pf-page" scrollY>
      {/* 标题 */}
      <View className="pf-header">
        {!isOnboarding && (
          <View className="pf-back" onClick={() => Taro.navigateBack()}>
            <Text className="pf-back-icon">←</Text>
          </View>
        )}
        <View className="pf-header-content">
          <Text className="pf-title">健康档案</Text>
          {isOnboarding && <Text className="pf-subtitle">填写后将为你制定个性化饮食方案</Text>}
        </View>
      </View>

      <View className="pf-body">
        {/* ── 基本信息 ── */}
        <View className="pf-card">
          {/* 性别 */}
          <View className="pf-row-label">
            <Text className="pf-label">性别</Text>
          </View>
          <View className="pf-gender-row">
            <View
              className={`pf-gender-btn ${profile.gender === 'male' ? 'pf-gender-btn--on' : ''}`}
              onClick={() => up('gender', 'male')}
            >
              <Text>男</Text>
            </View>
            <View
              className={`pf-gender-btn ${profile.gender === 'female' ? 'pf-gender-btn--on' : ''}`}
              onClick={() => up('gender', 'female')}
            >
              <Text>女</Text>
            </View>
          </View>

          {/* 出生年份 */}
          <View className="pf-label-row">
            <Text className="pf-label">出生年份 *</Text>
          </View>
          <Input
            className="pf-input"
            type="number"
            placeholder="例如 1995"
            value={profile.birthYear ? String(profile.birthYear) : ''}
            onInput={(e) => up('birthYear', Number(e.detail.value) || undefined)}
          />

          {/* 身高 / 体重 */}
          <View className="pf-row-2col">
            <View className="pf-col">
              <Text className="pf-label">身高 (cm) *</Text>
              <Input
                className="pf-input"
                type="digit"
                placeholder="170"
                value={profile.heightCm ? String(profile.heightCm) : ''}
                onInput={(e) => up('heightCm', Number(e.detail.value) || undefined)}
              />
            </View>
            <View className="pf-col">
              <Text className="pf-label">体重 (kg) *</Text>
              <Input
                className="pf-input"
                type="digit"
                placeholder="65"
                value={profile.weightKg ? String(profile.weightKg) : ''}
                onInput={(e) => up('weightKg', Number(e.detail.value) || undefined)}
              />
            </View>
          </View>

          {/* 目标体重 */}
          <View className="pf-label-row">
            <Text className="pf-label">目标体重 (kg)</Text>
          </View>
          <Input
            className="pf-input"
            type="digit"
            placeholder="60"
            value={profile.targetWeightKg ? String(profile.targetWeightKg) : ''}
            onInput={(e) => up('targetWeightKg', Number(e.detail.value) || undefined)}
          />
        </View>

        {/* ── 活动等级 ── */}
        <View className="pf-card">
          <Text className="pf-section-title">活动等级</Text>
          {activityOptions.map((opt) => (
            <View
              key={opt.key}
              className={`pf-option ${profile.activityLevel === opt.key ? 'pf-option--on' : ''}`}
              onClick={() => up('activityLevel', opt.key)}
            >
              <Text className="pf-option-label">{opt.label}</Text>
            </View>
          ))}
        </View>

        {/* ── 健康目标 ── */}
        <View className="pf-card">
          <Text className="pf-section-title">你的目标</Text>
          {goalOptions.map((opt) => (
            <View
              key={opt.key}
              className={`pf-option ${profile.goal === opt.key ? 'pf-option--on' : ''}`}
              onClick={() => up('goal', opt.key)}
            >
              <Text className="pf-option-label">{opt.label}</Text>
              <Text className="pf-option-desc">{opt.desc}</Text>
            </View>
          ))}

          <Text className="pf-sub-title">目标速度</Text>
          <View className="pf-row-3col">
            {goalSpeedOptions.map((opt) => (
              <View
                key={opt.key}
                className={`pf-speed-btn ${profile.goalSpeed === opt.key ? 'pf-speed-btn--on' : ''}`}
                onClick={() => up('goalSpeed', opt.key)}
              >
                <Text className="pf-speed-label">{opt.label}</Text>
                <Text className="pf-speed-desc">{opt.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 饮食习惯 ── */}
        <View className="pf-card">
          <Text className="pf-section-title">饮食习惯</Text>

          <Text className="pf-sub-title">一天几餐</Text>
          <View className="pf-row-chips">
            {mealsOptions.map((n) => (
              <View
                key={n}
                className={`pf-num-btn ${profile.mealsPerDay === n ? 'pf-num-btn--on' : ''}`}
                onClick={() => up('mealsPerDay', n)}
              >
                <Text>{n} 餐</Text>
              </View>
            ))}
          </View>

          <Text className="pf-sub-title">外卖频率</Text>
          <View className="pf-row-chips">
            {takeoutOptions.map((opt) => (
              <View
                key={opt.key}
                className={`pf-num-btn ${profile.takeoutFrequency === opt.key ? 'pf-num-btn--on' : ''}`}
                onClick={() => up('takeoutFrequency', opt.key)}
              >
                <Text>{opt.label}</Text>
              </View>
            ))}
          </View>

          <Text className="pf-sub-title">是否会做饭</Text>
          <View className="pf-row-chips">
            <View
              className={`pf-num-btn ${profile.canCook ? 'pf-num-btn--on' : ''}`}
              onClick={() => up('canCook', true)}
            >
              <Text>会做饭</Text>
            </View>
            <View
              className={`pf-num-btn ${!profile.canCook ? 'pf-num-btn--on' : ''}`}
              onClick={() => up('canCook', false)}
            >
              <Text>不会</Text>
            </View>
          </View>

          <Text className="pf-sub-title">
            饮食偏好 <Text className="pf-hint">（可多选）</Text>
          </Text>
          <Chips field="foodPreferences" opts={preferenceChips} />

          <Text className="pf-sub-title">
            忌口 <Text className="pf-hint">（可多选）</Text>
          </Text>
          <Chips field="dietaryRestrictions" opts={restrictionChips} />
        </View>

        {/* ── 行为习惯 ── */}
        <View className="pf-card">
          <Text className="pf-section-title">行为习惯</Text>

          <Text className="pf-sub-title">自律程度</Text>
          <View className="pf-row-chips">
            {disciplineOptions.map((opt) => (
              <View
                key={opt.key}
                className={`pf-num-btn ${profile.discipline === opt.key ? 'pf-num-btn--on' : ''}`}
                onClick={() => up('discipline', opt.key)}
              >
                <Text>{opt.label}</Text>
              </View>
            ))}
          </View>

          <Text className="pf-sub-title">
            容易乱吃时段 <Text className="pf-hint">（可多选）</Text>
          </Text>
          <Chips field="weakTimeSlots" opts={weakSlotChips} />
        </View>

        {/* ── 热量目标 ── */}
        <View className="pf-card">
          <Text className="pf-section-title">每日热量目标 (kcal，留空自动计算)</Text>
          <Input
            className="pf-input"
            type="number"
            placeholder="自动计算"
            value={profile.dailyCalorieGoal ? String(profile.dailyCalorieGoal) : ''}
            onInput={(e) => up('dailyCalorieGoal', Number(e.detail.value) || undefined)}
          />
        </View>

        {/* 按钮 */}
        <View className="pf-actions">
          <Button className="pf-save-btn" loading={saving} onClick={handleSave}>
            {isOnboarding ? '完成设置，开始使用 →' : '保存档案'}
          </Button>
          {isOnboarding && (
            <Button
              className="pf-skip-btn"
              onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
            >
              暂时跳过
            </Button>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

export default HealthProfilePage;
