import { GoogleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { App, Button, Card, ConfigProvider, Space, Typography, theme } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import authApi from '@/services/authService';
import { signInAdminWithGoogle } from '@/services/firebaseAuth';
import { useUserStore, useThemeStore } from '@/store';
import type { ManualRouteConfig } from '@/types/route';

const { Paragraph, Text, Title } = Typography;

export const routeConfig: ManualRouteConfig = {
  meta: {
    title: 'Login',
    requireAuth: false,
    hideInMenu: true,
  },
};

const LoginContent: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser, setToken } = useUserStore();
  const { mode } = useThemeStore();
  const { message } = App.useApp();

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const idToken = await signInAdminWithGoogle();
      const response = await authApi.firebaseGoogleLogin({ idToken });

      setToken(response.token);
      setUser(response.user);
      message.success('登录成功');
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Firebase Google 登录失败:', error);
      message.error(error?.message || '登录失败，请确认你已加入后台白名单');
    } finally {
      setLoading(false);
    }
  };

  const isDark = mode === 'dark';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark
          ? 'radial-gradient(circle at top, #1f2937 0%, #0f172a 45%, #020617 100%)'
          : 'radial-gradient(circle at top, #dbeafe 0%, #f8fafc 45%, #e2e8f0 100%)',
        padding: 24,
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 440,
          borderRadius: 20,
          boxShadow: isDark
            ? '0 24px 60px rgba(0, 0, 0, 0.35)'
            : '0 24px 60px rgba(15, 23, 42, 0.12)',
        }}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Space size={12} align="center">
            <SafetyCertificateOutlined style={{ fontSize: 28, color: '#1677ff' }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>
                后台管理登录
              </Title>
              <Text type="secondary">Firebase Google Auth + 邮箱白名单</Text>
            </div>
          </Space>

          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            仅允许已加入后台白名单且状态为“正常”的 Google 账号访问后台。登录成功后，
            后端会换发独立的 admin JWT，继续复用现有权限系统。
          </Paragraph>

          <Button
            type="primary"
            size="large"
            icon={<GoogleOutlined />}
            loading={loading}
            onClick={handleGoogleLogin}
            style={{ width: '100%', height: 48 }}
          >
            使用 Google 登录后台
          </Button>

          <div
            style={{
              borderRadius: 12,
              padding: 12,
              background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc',
            }}
          >
            <Text type="secondary">
              没有权限时请联系超级管理员，在“系统管理 / 用户管理”中将你的邮箱加入白名单。
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  );
};

const Login: React.FC = () => {
  const { mode, primaryColor } = useThemeStore();

  return (
    <ConfigProvider
      theme={{
        token: { colorPrimary: primaryColor },
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <App>
        <LoginContent />
      </App>
    </ConfigProvider>
  );
};

export default Login;
