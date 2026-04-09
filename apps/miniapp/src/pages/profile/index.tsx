import React, { useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useAuthStore } from '@/store/auth';
import * as foodService from '@/services/food';
import type { UserProfile } from '@/types/api';
import './index.scss';

const goalLabelMap: Record<string, string> = {
  fat_loss: '🔥 减脂',
  muscle_gain: '💪 增肌',
  health: '🧘 保持健康',
  habit: '🌱 改善习惯',
};

const activityLabelMap: Record<string, string> = {
  sedentary: '久坐不动',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高强度',
};

function ProfilePage() {
  const { user, logout } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useDidShow(() => {
    foodService
      .getProfile()
      .then((p) => setProfile(p))
      .catch(() => {});
  });

  const goEditProfile = () => {
    Taro.navigateTo({ url: '/pages/health-profile/index' });
  };

  const displayName = user?.nickname || user?.phone || 'uWay 用户';

  return (
    <View className="me-page">
      {/* 用户信息头部 */}
      <View className="me-header">
        <View className="me-avatar">
          <Text className="me-avatar-text">{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View className="me-user-info">
          <Text className="me-name">{displayName}</Text>
          {user?.phone && (
            <Text className="me-phone">
              {user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
            </Text>
          )}
        </View>
      </View>

      {/* 健康概览 */}
      {profile && (
        <View className="me-card me-card--summary">
          <View className="me-summary-row">
            <View className="me-summary-item">
              <Text className="me-summary-val">{profile.heightCm || '--'}</Text>
              <Text className="me-summary-key">身高 cm</Text>
            </View>
            <View className="me-summary-divider" />
            <View className="me-summary-item">
              <Text className="me-summary-val">{profile.weightKg || '--'}</Text>
              <Text className="me-summary-key">体重 kg</Text>
            </View>
            <View className="me-summary-divider" />
            <View className="me-summary-item">
              <Text className="me-summary-val">
                {profile.goal ? goalLabelMap[profile.goal] : '--'}
              </Text>
              <Text className="me-summary-key">目标</Text>
            </View>
            <View className="me-summary-divider" />
            <View className="me-summary-item">
              <Text className="me-summary-val">
                {profile.activityLevel ? activityLabelMap[profile.activityLevel] : '--'}
              </Text>
              <Text className="me-summary-key">活动</Text>
            </View>
          </View>
        </View>
      )}

      {/* 菜单列表 */}
      <View className="me-section">
        <View className="me-menu-item" onClick={goEditProfile}>
          <View className="me-menu-left">
            <Text className="me-menu-icon">📋</Text>
            <Text className="me-menu-label">健康档案</Text>
          </View>
          <View className="me-menu-right">
            {!profile?.onboardingCompleted && <Text className="me-menu-badge">未完善</Text>}
            <Text className="me-menu-arrow">›</Text>
          </View>
        </View>
      </View>

      {/* 退出登录 */}
      <View className="me-footer">
        <Button className="me-logout-btn" onClick={logout}>
          退出登录
        </Button>
      </View>
    </View>
  );
}

export default ProfilePage;
