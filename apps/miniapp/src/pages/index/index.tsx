import React, { useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button } from '@nutui/nutui-react-taro'
import { useAuthStore } from '@/store/auth'
import './index.scss'

function Index() {
  const { isLoggedIn, user, logout } = useAuthStore()

  useEffect(() => {
    if (!isLoggedIn) {
      Taro.redirectTo({ url: '/pages/login/index' })
    }
  }, [isLoggedIn])

  if (!isLoggedIn) return null

  return (
    <View className='index-page'>
      <View className='index-header'>
        <Text className='index-welcome'>
          你好，{user?.nickname || '用户'}
        </Text>
      </View>
      <View className='index-body'>
        <Text className='index-hint'>uWay 智能饮食健康助手</Text>
      </View>
      <View className='index-footer'>
        <Button size='small' onClick={logout}>
          退出登录
        </Button>
      </View>
    </View>
  )
}

export default Index
