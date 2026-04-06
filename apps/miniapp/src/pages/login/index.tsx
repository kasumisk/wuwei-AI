import React, { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button, Input } from '@nutui/nutui-react-taro'
import { useAuthStore } from '@/store/auth'
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

  /** 微信一键登录 */
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

  /** 发送验证码 */
  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    setSending(true)
    try {
      const { post } = await import('@/services/request')
      await post('/app/auth/phone/send-code', { phone }, { noAuth: true })
      Taro.showToast({ title: '验证码已发送', icon: 'success' })
      // 倒计时
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

  /** 手机号登录 */
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
    <View className='login-page'>
      <View className='login-header'>
        <Text className='login-title'>欢迎使用 uWay</Text>
        <Text className='login-subtitle'>智能饮食健康助手</Text>
      </View>

      {mode === 'wechat' ? (
        <View className='login-body'>
          <Button
            type='primary'
            block
            loading={loading}
            onClick={handleWxLogin}
          >
            微信一键登录
          </Button>
          <View className='login-switch' onClick={() => setMode('phone')}>
            <Text className='login-switch-text'>使用手机号登录</Text>
          </View>
        </View>
      ) : (
        <View className='login-body'>
          <View className='login-field'>
            <Input
              placeholder='请输入手机号'
              type='number'
              maxLength={11}
              value={phone}
              onChange={(val) => setPhone(val)}
            />
          </View>
          <View className='login-field login-code-row'>
            <View className='login-code-input'>
              <Input
                placeholder='请输入验证码'
                type='number'
                maxLength={6}
                value={code}
                onChange={(val) => setCode(val)}
              />
            </View>
            <Button
              size='small'
              disabled={countdown > 0 || sending}
              onClick={handleSendCode}
            >
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </Button>
          </View>
          <Button
            type='primary'
            block
            loading={loading}
            onClick={handlePhoneLogin}
          >
            登录 / 注册
          </Button>
          <View className='login-switch' onClick={() => setMode('wechat')}>
            <Text className='login-switch-text'>使用微信登录</Text>
          </View>
        </View>
      )}

      <View className='login-footer'>
        <Text className='login-agreement'>
          登录即同意《用户协议》和《隐私政策》
        </Text>
      </View>
    </View>
  )
}

export default LoginPage
