import React, { useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAuthStore } from '@/store/auth'
import * as foodService from '@/services/food'
import type { UserProfile } from '@/types/api'
import './index.scss'

const activityOptions = [
  { key: 'sedentary', label: '久坐不动', desc: '很少运动' },
  { key: 'light', label: '轻度活动', desc: '每周1-3天' },
  { key: 'moderate', label: '中度活动', desc: '每周3-5天' },
  { key: 'active', label: '高强度', desc: '每周6-7天' },
]

function ProfilePage() {
  const { user, logout } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<Partial<UserProfile>>({})

  useDidShow(() => { loadProfile() })

  const loadProfile = async () => {
    setLoading(true)
    try { const p = await foodService.getProfile(); setProfile(p || {}) }
    catch {} finally { setLoading(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await foodService.saveProfile(profile)
      setProfile(updated); setEditing(false)
      Taro.showToast({ title: '保存成功', icon: 'success' })
    } catch (err: any) { Taro.showToast({ title: err?.message || '保存失败', icon: 'none' }) }
    finally { setSaving(false) }
  }

  const updateField = (key: keyof UserProfile, value: any) => setProfile(prev => ({ ...prev, [key]: value }))

  const renderField = (label: string, key: keyof UserProfile, type: string = 'text', placeholder?: string) => (
    <View className='flex items-center justify-between py-3 border-b border-gray-50'>
      <Text className='text-sm text-gray-700 shrink-0'>{label}</Text>
      {editing ? (
        <Input
          className='profile-input'
          type={type as any}
          placeholder={placeholder || label}
          value={String(profile[key] || '')}
          onInput={e => updateField(key, type === 'text' ? e.detail.value : (Number(e.detail.value) || undefined))}
        />
      ) : (
        <Text className='text-sm text-gray-500'>{profile[key] ? String(profile[key]) : '-'}</Text>
      )}
    </View>
  )

  return (
    <View className='min-h-screen bg-gray-50 p-5'>
      <View className='flex items-center bg-white rounded-2xl p-5 mb-4'>
        <View className='profile-avatar shrink-0 mr-4'>
          <Text className='text-xl text-white'>{user?.nickname?.[0] || '👤'}</Text>
        </View>
        <View className='flex-1'>
          <Text className='block text-lg font-semibold'>{user?.nickname || '用户'}</Text>
          <Text className='block text-xs text-gray-400 mt-1'>{user?.phone || user?.email || ''}</Text>
        </View>
        {!editing && (
          <Text className='text-sm text-blue-500' onClick={() => setEditing(true)}>编辑</Text>
        )}
      </View>

      <View className='bg-white rounded-2xl p-5 mb-4'>
        <Text className='block text-base font-semibold mb-3'>健康档案</Text>

        <View className='flex items-center justify-between py-3 border-b border-gray-50'>
          <Text className='text-sm text-gray-700'>性别</Text>
          {editing ? (
            <View className='flex gap-2'>
              <View className={`profile-opt ${profile.gender === 'male' ? 'profile-opt--active' : ''}`} onClick={() => updateField('gender', 'male')}>
                <Text>男</Text>
              </View>
              <View className={`profile-opt ${profile.gender === 'female' ? 'profile-opt--active' : ''}`} onClick={() => updateField('gender', 'female')}>
                <Text>女</Text>
              </View>
            </View>
          ) : (
            <Text className='text-sm text-gray-500'>{profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '-'}</Text>
          )}
        </View>

        {renderField('出生年份', 'birthYear', 'number', '如 1990')}
        {renderField('身高 (cm)', 'heightCm', 'digit', '如 175')}
        {renderField('体重 (kg)', 'weightKg', 'digit', '如 70')}
        {renderField('目标体重 (kg)', 'targetWeightKg', 'digit', '如 65')}

        <View className='py-3 border-b border-gray-50'>
          <Text className='text-sm text-gray-700 mb-2 block'>活动等级</Text>
          {editing ? (
            <View className='flex flex-col gap-2 mt-2'>
              {activityOptions.map(opt => (
                <View
                  key={opt.key}
                  className={`profile-opt px-4 py-3 rounded-xl ${profile.activityLevel === opt.key ? 'profile-opt--active' : ''}`}
                  onClick={() => updateField('activityLevel', opt.key)}
                >
                  <Text className='block text-sm font-medium'>{opt.label}</Text>
                  <Text className='block text-xs text-gray-400'>{opt.desc}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text className='text-sm text-gray-500'>{activityOptions.find(o => o.key === profile.activityLevel)?.label || '-'}</Text>
          )}
        </View>

        {renderField('每日热量目标', 'dailyCalorieGoal', 'number', '留空自动计算')}
      </View>

      {editing ? (
        <View className='pb-10'>
          <Button className='profile-save-btn' loading={saving} onClick={handleSave}>保存</Button>
          <Button className='profile-cancel-btn mt-3' onClick={() => { setEditing(false); loadProfile() }}>取消</Button>
        </View>
      ) : (
        <View className='pb-10'>
          <Button className='profile-logout-btn' onClick={logout}>退出登录</Button>
        </View>
      )}
    </View>
  )
}

export default ProfilePage
