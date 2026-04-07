import React, { useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAuthStore } from '@/store/auth'
import { post } from '@/services/request'
import './index.scss'

type LoginMode = 'wechat' | 'phone'

function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('wechat')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(false)

  const wxLogin = useAuthStore((s) => s.wxLogin)
  const phoneLogin = useAuthStore((s) => s.phoneLogin)

  const handleWxLogin = async () => {
    setLoading(true)
    try {
      await wxLogin()
      Taro.switchTab({ url: '/pages/index/index' })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '登录失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    setSending(true)
    try {
      await post('/app/auth/phone/send-code', { phone }, { noAuth: true })
      Taro.showToast({ title: '验证码已发送', icon: 'success' })
      let sec = 60
      setCountdown(sec)
      const timer = setInterval(() => {
        sec--
        setCountdown(sec)
        if (sec <= 0) clearInterval(timer)
      }, 1000)
    } catch {
      Taro.showToast({ title: '发送失败', icon: 'none' })
    } finally {
      setSending(false)
    }
  }

  const handlePhoneLogin = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!code) {
      Taro.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      await phoneLogin(phone, code)
      Taro.switchTab({ url: '/pages/index/index' })
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '登录失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='flex flex-col min-h-screen px-12 pb-16 bg-white'>
      {/* Logo + Title */}
      <View className='flex flex-col items-center pt-28 mb-20'>
        <View className='login-logo mb-8'>
          <Text className='text-4xl'>🥗</Text>
        </View>
        <Text className='block text-3xl font-bold text-center mb-2'>欢迎使用 uWay</Text>
        <Text className='block text-base text-gray-400 text-center'>智能饮食健康助手</Text>
      </View>

      {/* Content */}
      <View className='flex-1'>
        {mode === 'wechat' ? (
          <View>
            <Button
              className='login-btn login-btn--primary'
              loading={loading}
              onClick={handleWxLogin}
            >
              微信一键登录
            </Button>

            <View className='flex items-center my-10'>
              <View className='flex-1 h-px bg-gray-200' />
              <Text className='text-xs text-gray-300 px-4'>或</Text>
              <View className='flex-1 h-px bg-gray-200' />
            </View>

            <Button
              className='login-btn login-btn--outline'
              onClick={() => setMode('phone')}
            >
              手机号登录
            </Button>
          </View>
        ) : (
          <View>
            <View className='flex items-center h-12 bg-gray-50 rounded-lg px-4 mb-4'>
              <Text className='text-sm text-gray-600 mr-3 pr-3 border-r border-gray-200'>+86</Text>
              <Input
                className='flex-1 text-sm h-12'
                placeholder='请输入手机号'
                type='number'
                maxlength={11}
                value={phone}
                onInput={(e) => setPhone(e.detail.value)}
              />
            </View>

            <View className='flex items-center h-12 bg-gray-50 rounded-lg px-4 mb-6 gap-3'>
              <Input
                className='flex-1 text-sm h-12'
                placeholder='请输入验证码'
                type='number'
                maxlength={6}
                value={code}
                onInput={(e) => setCode(e.detail.value)}
              />
              <Button
                className='login-code-btn'
                disabled={countdown > 0 || sending}
                onClick={handleSendCode}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Button>
            </View>

            <Button
              className='login-btn login-btn--primary'
              loading={loading}
              onClick={handlePhoneLogin}
            >
              登录 / 注册
            </Button>

            <View className='text-center mt-8 py-3' onClick={() => setMode('wechat')}>
              <Text className='text-sm text-blue-500'>使用微信登录</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer */}
      <View className='text-center pt-8'>
        <Text className='text-xs text-gray-300 leading-relaxed'>
          登录即同意《用户协议》和《隐私政策》
        </Text>
      </View>
    </View>
  )
}

export default LoginPage
