import React, { useMemo, useEffect, useRef, useState, useCallback, createContext } from 'react';
import { ProLayout } from '@ant-design/pro-layout';
import { useNavigate, useLocation } from 'react-router-dom';
import { ConfigProvider, theme, App, Spin } from 'antd';
import * as Icons from '@ant-design/icons';
import { useThemeStore, useUserStore } from '@/store';
import TabsView from '@/components/TabsView';
import UserFooter from '@/components/UserFooter';
import { menuItems, autoRoutes } from '@/router';
import ProtectedRoute from '@/components/ProtectedRoute';
import { setGlobalMessage } from '@/utils/message';
import { setGlobalModal } from '@/utils/modal';
import authApi from '@/services/authService';
import { isMobile } from 'react-device-detect';
import KeepAliveRouteOutlet from 'keepalive-for-react-router';
import { useKeepAliveRef, type KeepAliveRef } from 'keepalive-for-react';

// ─── KeepAlive Ref Context ──────────────────────────────────────────────────
// 将 aliveRef 通过 context 暴露给 TabsView / useCloseTab 等组件，
// 使其可以在关闭标签时调用 destroy(cacheKey) 清理缓存。
export const KeepAliveRefContext = createContext<React.RefObject<KeepAliveRef | null> | null>(null);

// MessageProvider 提取到组件外部，避免每次 Layout 渲染时重新创建组件定义
const MessageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message, modal } = App.useApp();

  useEffect(() => {
    setGlobalMessage(message);
    setGlobalModal(modal);
  }, [message, modal]);

  return <>{children}</>;
};

const Layout: React.FC = () => {
  const aliveRef = useKeepAliveRef();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, primaryColor } = useThemeStore();
  const { user, setToken } = useUserStore();
  const [loading, setLoading] = useState(false);
  const authRef = useRef<boolean>(false);

  // 用 ref 跟踪 URL 上的 token（只在首次挂载时检测）
  const initialTokenRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('token')
  );

  // 动态生成菜单配置
  const menuData = useMemo(() => {
    // 检查用户是否有权限访问菜单项
    const hasPermission = (routeConfig: any) => {
      if (!user) return false;

      const isAdmin = user.role === 'admin' || user.role === 'super_admin';
      if (isAdmin) return true;

      if (routeConfig?.requireAdmin && !isAdmin) return false;

      return true;
    };

    // 将字符串图标转换为组件，并转换为 ProLayout 需要的格式
    const processMenuItems = (items: typeof menuItems): any[] => {
      return items
        .map((item) => {
          const routeItem = autoRoutes.find((route) => route.path === item.path);
          const routeConfig = (routeItem?.meta || {}) as any;

          if (!hasPermission(routeConfig)) return null;
          if (routeConfig?.hideInMenu) return null;

          let iconElement;
          const iconSource = routeConfig?.icon || item.icon;

          if (iconSource) {
            if (typeof iconSource === 'string') {
              const IconComponent = (Icons as unknown as Record<string, React.ComponentType>)[
                iconSource
              ];
              iconElement = IconComponent
                ? React.createElement(IconComponent)
                : React.createElement(Icons.FileOutlined);
            } else if (React.isValidElement(iconSource)) {
              iconElement = iconSource;
            } else {
              iconElement = React.createElement(Icons.FileOutlined);
            }
          }

          return {
            path: item.path,
            name: routeConfig?.title || item.label,
            icon: iconElement,
            children: item.children ? processMenuItems(item.children) : undefined,
            meta: routeConfig,
          };
        })
        .filter(Boolean);
    };

    return processMenuItems(menuItems);
  }, [user]);

  const themeConfig = useMemo(
    () => ({
      token: {
        colorPrimary: primaryColor,
      },
      algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    }),
    [mode, primaryColor]
  );

  // 稳定的路由对象引用 — 只在 menuData 变化时重新创建
  const routeData = useMemo(() => ({ routes: menuData }), [menuData]);

  // 稳定的 navigate 回调
  const handleMenuClick = useCallback(
    (item: any) => {
      if (item.path) navigate(item.path);
    },
    [navigate]
  );

  const handleLogoClick = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  // 处理 URL 中的 token 参数（只在挂载时执行一次）
  useEffect(() => {
    const token = initialTokenRef.current;
    if (!token) return;
    if (authRef.current) return;
    authRef.current = true;

    (async () => {
      setLoading(true);
      try {
        const result = await authApi.authBytoken({ token });
        setToken(result.token);

        // 清除 URL 中的 token
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState({}, '', url.toString());

        navigate('/dashboard');
      } finally {
        authRef.current = false;
        setLoading(false);
        initialTokenRef.current = null;
      }
    })();
  }, [navigate, setToken]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
        }}
      >
        <Spin size="large" tip="正在认证..." />
      </div>
    );
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <App>
        <MessageProvider>
          <ProtectedRoute>
            <KeepAliveRefContext.Provider value={aliveRef}>
              <div style={{ height: '100vh' }}>
                <ProLayout
                  route={routeData}
                  location={{
                    pathname: location.pathname,
                  }}
                  title="运营管理"
                  logo="https://gw.alipayobjects.com/zos/antfincdn/PmY%24TNNDBI/logo.svg"
                  menuHeaderRender={(logo, title) => (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                      }}
                      className="h-8 gap-2"
                      onClick={handleLogoClick}
                    >
                      <div className="h-8 w-8">{logo}</div>
                      {title}
                    </div>
                  )}
                  menuFooterRender={() => <UserFooter />}
                  menuItemRender={(item: any, dom: React.ReactNode) => (
                    <div onClick={() => handleMenuClick(item)}>{dom}</div>
                  )}
                  layout="side"
                  siderWidth={208}
                  contentStyle={{
                    paddingTop: 0,
                    paddingInline: isMobile ? 8 : 24,
                  }}
                >
                  <TabsView />
                  <div style={{ marginTop: 20, minHeight: 'calc(100vh - 112px)' }}>
                    <KeepAliveRouteOutlet
                      aliveRef={aliveRef}
                      max={20}
                    />
                  </div>
                </ProLayout>
              </div>
            </KeepAliveRefContext.Provider>
          </ProtectedRoute>
        </MessageProvider>
      </App>
    </ConfigProvider>
  );
};

export default Layout;
