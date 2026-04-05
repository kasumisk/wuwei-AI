import { LoginFormPage, ProFormText, ProFormCaptcha } from '@ant-design/pro-components';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Tabs, ConfigProvider, theme, App } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore, useThemeStore } from '@/store';
import authApi from '@/services/authService';
import type { ManualRouteConfig } from '@/types/route';
import type { SendCodeRequestDto } from '@ai-platform/shared';

type LoginType = 'email';

// Validate email format
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const isValidEmail = (email: string): boolean => {
  return emailRegex.test(email);
};

export const routeConfig: ManualRouteConfig = {
  meta: {
    title: 'Login',
    requireAuth: false,
    hideInMenu: true,
  },
};

const LoginContent: React.FC = () => {
  const [loginType, setLoginType] = useState<LoginType>('email');
  const [loading, setLoading] = useState(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [email, setEmail] = useState<string>('');
  const navigate = useNavigate();
  const { setUser, setToken } = useUserStore();
  const { mode } = useThemeStore();
  const { message } = App.useApp();

  const handleSubmit = async (values: Record<string, unknown>) => {
    setLoading(true);
    try {
      const emailValue = values.email as string;
      const captcha = values.captcha as string;

      // 调用登录接口
      const loginParams = {
        username: emailValue,
        password: captcha,
      };

      const response = await authApi.login(loginParams);

      console.log('token', response.token);
      setToken(response.token);

      // 登录成功后获取用户信息
      // const userInfo = await authApi.getUserInfo();

      // // 更新用户状态
      setUser({
        ...response.user,
      });

      message.success('Login successful!');
      navigate('/dashboard');
    } catch (error) {
      console.error('登录失败:', error);
      message.error('Login failed, please check your email and verification code');
    } finally {
      setLoading(false);
    }
  };

  // 发送验证码
  const handleGetCaptcha = async (emailValue: string) => {
    setCaptchaLoading(true);
    try {
      if (!emailValue || !isValidEmail(emailValue)) {
        message.error('Please enter a valid email address first');
        throw new Error('Invalid email format');
      }

      const sendCodeParams: SendCodeRequestDto = {
        phone: emailValue,
        type: 'login',
      };

      await authApi.sendCode(sendCodeParams);
      message.success('Verification code has been sent to your email');
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid email format') {
        // Error message already displayed, no need to repeat
      } else {
        message.error('Failed to send verification code, please try again');
      }
      throw error; // 抛出错误以阻止倒计时
    } finally {
      setCaptchaLoading(false);
    }
  };

  const isDark = mode === 'dark';

  // 动态样式配置
  const containerStyle = {
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.65)',
    backdropFilter: 'blur(4px)',
  };

  return (
    <div
      style={{
        backgroundColor: isDark ? '#141414' : 'white',
        height: '100vh',
        transition: 'background-color 0.3s ease',
      }}
    >
      <LoginFormPage
        backgroundImageUrl="https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/V-_oS6r-i7wAAAAAAAAAAAAAFl94AQBr"
        backgroundVideoUrl="https://gw.alipayobjects.com/v/huamei_gcee1x/afts/video/jXRBRK_VAwoAAAAAAAAAAAAAK4eUAQBr"
        logo={<img alt="logo" src="/logo.svg" />}
        title={<span className="text-white">Card3 Printer</span>}
        containerStyle={containerStyle}
        subTitle={<span className="text-white">Card3 Print Management System</span>}
        loading={loading}
        onFinish={handleSubmit}
      >
        <Tabs
          centered
          activeKey={loginType}
          onChange={(activeKey) => setLoginType(activeKey as LoginType)}
          items={[
            {
              key: 'email',
              label: 'Email Login',
            },
          ]}
        />
        {loginType === 'email' && (
          <>
            <ProFormText
              fieldProps={{
                size: 'large',
                prefix: <MailOutlined className={'prefixIcon'} />,
                onChange: (e) => {
                  setEmail(e.target.value);
                },
              }}
              name="email"
              placeholder={'Please enter your email'}
              rules={[
                {
                  required: true,
                  message: 'Please enter your email!',
                },
              ]}
            />
            <ProFormCaptcha
              fieldProps={{
                size: 'large',
                prefix: <LockOutlined className={'prefixIcon'} />,
              }}
              captchaProps={{
                size: 'large',
                loading: captchaLoading,
              }}
              placeholder={'Please enter verification code'}
              captchaTextRender={(timing, count) => {
                if (timing) {
                  return <span className="text-white">{`Resend in ${count}s`}</span>;
                }
                return 'Get Code';
              }}
              phoneName="email"
              name="captcha"
              rules={[
                {
                  required: true,
                  message: 'Please enter verification code!',
                },
              ]}
              onGetCaptcha={async () => {
                await handleGetCaptcha(email);
              }}
            />
          </>
        )}
        {/* <div
          style={{
            marginBottom: 24,
          }}
        >
          <ProFormCheckbox noStyle name="autoLogin">
            <span className='text-white'>Remember me</span>
          </ProFormCheckbox>
        </div> */}
      </LoginFormPage>
    </div>
  );
};

const Login: React.FC = () => {
  const { mode, primaryColor } = useThemeStore();

  // 根据主题模式配置样式
  const themeConfig = {
    token: {
      colorPrimary: primaryColor,
    },
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
  };

  return (
    <ConfigProvider theme={themeConfig}>
      <App>
        <LoginContent />
      </App>
    </ConfigProvider>
  );
};

export default Login;
