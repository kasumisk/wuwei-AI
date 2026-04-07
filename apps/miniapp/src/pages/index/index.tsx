import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, Image, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAuthStore } from '@/store/auth'
import * as foodService from '@/services/food'
import type { DailySummary, FoodRecord } from '@/types/api'
import './index.scss'

const mealTypeMap: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐',
}
const mealEmoji: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪',
}

function Index() {
  const { isLoggedIn, user } = useAuthStore()
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [records, setRecords] = useState<FoodRecord[]>([])

  const fetchData = useCallback(async () => {
    if (!isLoggedIn) return
    try {
      const [s, r] = await Promise.all([
        foodService.getTodaySummary(),
        foodService.getTodayRecords(),
      ])
      setSummary(s)
      setRecords(r)
    } catch {}
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) Taro.reLaunch({ url: '/pages/login/index' })
  }, [isLoggedIn])

  useDidShow(() => { fetchData() })

  if (!isLoggedIn) return null

  const goal = summary?.calorieGoal || 2000
  const consumed = summary?.totalCalories || 0
  const remaining = Math.max(0, goal - consumed)
  const pct = Math.min(100, Math.round((consumed / goal) * 100))

  return (
    <View className='min-h-screen bg-gray-50 pb-4'>
      {/* Header */}
      <View className='px-5 pt-6 pb-4'>
        <Text className='block text-2xl font-bold'>你好，{user?.nickname || '用户'} 👋</Text>
        <Text className='block text-sm text-gray-400 mt-1'>今天吃了什么？</Text>
      </View>

      {/* AI Coach Banner */}
      <View className='mx-5 mb-4' onClick={() => Taro.switchTab({ url: '/pages/coach/index' })}>
        <View className='hero-card flex items-center p-5'>
          <Text className='text-3xl mr-3'>🤖</Text>
          <View className='flex-1'>
            <Text className='block text-lg font-semibold text-white'>AI 健康教练</Text>
            <Text className='block text-xs text-white mt-1' style={{ opacity: 0.8 }}>随时咨询饮食建议，获取个性化指导</Text>
          </View>
          <Text className='text-2xl text-white' style={{ opacity: 0.6 }}>›</Text>
        </View>
      </View>

      {/* Stats */}
      <View className='mx-5 mb-4 bg-white rounded-2xl p-5'>
        <View className='flex flex-col items-center pb-4'>
          <Text className='text-5xl font-bold text-blue-500'>{remaining}</Text>
          <Text className='text-xs text-gray-400 mt-1'>剩余千卡</Text>
        </View>
        <View className='progress-bar mb-4'>
          <View className='progress-fill' style={{ width: `${pct}%` }} />
        </View>
        <View className='flex justify-around'>
          <View className='text-center flex-1'>
            <Text className='block text-xl font-semibold'>{consumed}</Text>
            <Text className='block text-xs text-gray-400 mt-1'>已摄入</Text>
          </View>
          <View className='text-center flex-1'>
            <Text className='block text-xl font-semibold'>{goal}</Text>
            <Text className='block text-xs text-gray-400 mt-1'>目标</Text>
          </View>
          <View className='text-center flex-1'>
            <Text className='block text-xl font-semibold'>{summary?.mealCount || 0}</Text>
            <Text className='block text-xs text-gray-400 mt-1'>餐数</Text>
          </View>
        </View>
      </View>

      {/* CTA */}
      <View className='mx-5 mb-4'>
        <Button className='cta-btn' onClick={() => Taro.switchTab({ url: '/pages/analyze/index' })}>
          📸 拍照/上传分析食物
        </Button>
      </View>

      {/* Records */}
      <View className='px-5'>
        <Text className='block text-lg font-semibold mb-3'>今日饮食记录</Text>
        {records.length === 0 ? (
          <View className='bg-white rounded-xl p-10 text-center'>
            <Text className='text-sm text-gray-400'>还没有记录，快去拍照分析吧 🍽️</Text>
          </View>
        ) : (
          records.map((r) => (
            <View className='flex items-center bg-white rounded-xl p-4 mb-3' key={r.id}>
              <View className='mr-3'>
                {r.imageUrl ? (
                  <Image className='w-12 h-12 rounded-lg' src={r.imageUrl} mode='aspectFill' />
                ) : (
                  <View className='w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center'>
                    <Text className='text-2xl'>{mealEmoji[r.mealType] || '🍽️'}</Text>
                  </View>
                )}
              </View>
              <View className='flex-1 min-w-0'>
                <Text className='block text-sm font-medium truncate'>
                  {r.foods?.map((f) => f.name).join('、') || '未知食物'}
                </Text>
                <Text className='block text-xs text-gray-400 mt-1'>
                  {mealTypeMap[r.mealType] || r.mealType}
                  {r.isHealthy != null && (r.isHealthy ? ' · 🟢 健康' : ' · 🟡 偏高')}
                </Text>
              </View>
              <View className='text-right ml-3'>
                <Text className='block text-lg font-bold text-blue-500'>{r.totalCalories}</Text>
                <Text className='block text-xs text-gray-400'>千卡</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  )
}

export default Index
