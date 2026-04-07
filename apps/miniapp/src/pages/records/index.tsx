import React, { useState, useEffect } from 'react'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import * as foodService from '@/services/food'
import type { FoodRecord } from '@/types/api'
import './index.scss'

const mealTypeMap: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐',
}

function RecordsPage() {
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadRecords(1) }, [])

  const loadRecords = async (p: number) => {
    setLoading(true)
    try {
      const res = await foodService.getRecords(p, 20)
      if (p === 1) setRecords(res.items)
      else setRecords(prev => [...prev, ...res.items])
      setTotal(res.total); setPage(p)
    } catch {} finally { setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    try {
      await Taro.showModal({ title: '确认', content: '确定删除该记录？' })
      await foodService.deleteRecord(id)
      setRecords(prev => prev.filter(r => r.id !== id))
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch {}
  }

  return (
    <View className='flex flex-col min-h-screen bg-gray-50'>
      <View className='flex items-center justify-between px-5 py-4'>
        <Text className='text-xl font-bold'>饮食记录</Text>
        <Text className='text-xs text-gray-400'>{total} 条记录</Text>
      </View>

      <ScrollView scrollY className='flex-1 px-5 pb-5' onScrollToLower={() => { if (records.length < total && !loading) loadRecords(page + 1) }}>
        {records.length === 0 && !loading ? (
          <View className='py-20 text-center'><Text className='text-sm text-gray-400'>暂无记录</Text></View>
        ) : records.map(record => (
          <View className='bg-white rounded-xl p-4 mb-3' key={record.id}>
            <View className='flex'>
              {record.imageUrl && <Image className='record-img shrink-0 rounded-lg mr-3' src={record.imageUrl} mode='aspectFill' />}
              <View className='flex-1 min-w-0'>
                <Text className='block text-sm font-medium truncate'>{record.foods?.map(f => f.name).join('、') || '未知食物'}</Text>
                <Text className='block text-xs text-blue-500 mt-1'>{mealTypeMap[record.mealType]} · {record.totalCalories} 千卡</Text>
                <Text className='block text-xs text-gray-400 mt-1' style={{ fontSize: '20rpx' }}>{new Date(record.recordedAt || record.createdAt).toLocaleString()}</Text>
              </View>
            </View>
            {record.advice && <Text className='block text-xs text-gray-500 mt-3 leading-relaxed'>💡 {record.advice}</Text>}
            <View className='flex justify-end mt-2'>
              <Text className='text-xs text-red-400 px-2' onClick={() => handleDelete(record.id)}>删除</Text>
            </View>
          </View>
        ))}
        {loading && <View className='py-8 text-center'><Text className='text-sm text-gray-400'>加载中...</Text></View>}
      </ScrollView>
    </View>
  )
}

export default RecordsPage
