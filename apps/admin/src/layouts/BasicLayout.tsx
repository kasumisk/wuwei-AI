import React, { useMemo, useEffect, useRef, useState } from 'react';
import { ProLayout } from '@ant-design/pro-layout';
import { Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ConfigProvider, theme, App, Card } from 'antd';
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

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, primaryColor } = useThemeStore();
  const { user, setToken } = useUserStore();
  const [query] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const token = query.get('token');
  const authRef = useRef<boolean>(false);
  // 内部组件，用于设置全局 message 和 modal
  const MessageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { message, modal } = App.useApp();

    useEffect(() => {
      setGlobalMessage(message);
      setGlobalModal(modal);
    }, [message, modal]);

    return <>{children}</>;
  };

  // 动态生成菜单配置
  const menuData = useMemo(() => {
    // 检查用户是否有权限访问菜单项
    const hasPermission = (routeConfig: any) => {
      // console.log('🔍 权限检查:', {
      //   path: routeConfig?.path || 'unknown',
      //   title: routeConfig?.title || 'unknown',
      //   routeConfig,
      //   user: user ? { id: user.id, username: user.username, is_admin: user.is_admin } : null
      // });

      // 如果没有用户信息，默认不显示
      if (!user) {
        console.log('❌ 无用户信息，拒绝访问');
        return false;
      }

      // 管理员用户拥有所有权限
      const isAdmin = (user.role === 'admin' || user.role === 'super_admin');
      if (isAdmin) {
        console.log('✅ 管理员用户，允许访问');
        return true;
      }

      // 如果配置了requireAdmin，则只有管理员可以访问
      if (routeConfig?.requireAdmin && !isAdmin) {
        console.log('❌ 需要管理员权限，但用户非管理员，拒绝访问');
        return false;
      }

      // // 如果配置了roles，检查用户角色
      // if (routeConfig?.roles && routeConfig.roles.length > 0) {
      //   const hasRole = routeConfig.roles.some((role: string) =>
      //     user.roles.includes(role)
      //   );
      //   return hasRole;
      // }

      // // 如果配置了permissions，检查用户权限
      // if (routeConfig?.permissions && routeConfig.permissions.length > 0) {
      //   const hasPermission = routeConfig.permissions.some(
      //     (permission: string) => user.permissions.includes(permission)
      //   );
      //   return hasPermission;
      // }

      // 默认允许访问
      return true;
    };

    // 将字符串图标转换为组件，并转换为 ProLayout 需要的格式
    const processMenuItems = (items: typeof menuItems): any[] => {
      return items
        .map((item) => {
          // 查找对应的路由配置
          const routeItem = autoRoutes.find((route) => route.path === item.path);
          const routeConfig = (routeItem?.meta || {}) as any;

          // 检查权限
          if (!hasPermission(routeConfig)) {
            console.log('🚫 权限检查失败，跳过菜单项:', item.path);
            return null; // 没有权限则不显示
          }

          // 检查是否隐藏在菜单中
          if (routeConfig?.hideInMenu) {
            console.log('👁️ 菜单项被标记为隐藏，跳过:', item.path);
            return null;
          }

          let iconElement;

          // 优先使用 routeConfig 中的图标，其次使用 menuItem 中的图标
          const iconSource = routeConfig?.icon || item.icon;

          if (iconSource) {
            if (typeof iconSource === 'string') {
              // 字符串格式的图标名称
              const IconComponent = (Icons as unknown as Record<string, React.ComponentType>)[
                iconSource
              ];
              iconElement = IconComponent
                ? React.createElement(IconComponent)
                : React.createElement(Icons.FileOutlined);
            } else if (React.isValidElement(iconSource)) {
              // React 组件格式的图标
              iconElement = iconSource;
            } else {
              // 默认图标
              iconElement = React.createElement(Icons.FileOutlined);
            }
          }

          return {
            path: item.path,
            name: routeConfig?.title || item.label, // 优先使用 routeConfig 中的标题
            icon: iconElement,
            children: item.children ? processMenuItems(item.children) : undefined,
            // 添加额外的路由配置信息
            meta: routeConfig,
          };
        })
        .filter(Boolean); // 过滤掉 null 值
    };

    const processedMenu = processMenuItems(menuItems);
    return processedMenu;
  }, [user]); // 添加 user 依赖

  const themeConfig = {
    token: {
      colorPrimary: primaryColor,
    },
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
  };

  useEffect(() => {
    (async () => {
      if (token) {
        if (authRef.current) return;
        authRef.current = true;
        setLoading(true);
        try {
          console.log('authBytoken', token);
          const result = await authApi.authBytoken({ token });
          // if (err) {
          //   globalMessage.error(err);
          //   return;
          // }
          // localStorage.setItem("userToken", `Bearer ${result}`);
          setToken(result.token);
          console.log('auth userToken', result);
          navigate('/dashboard');
        } finally {
          authRef.current = false;
          setLoading(false);
        }
      } else {
        // setToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoxMC4wLCJ1c2VyX25hbWUiOiJIYWlqaSIsImlkIjoxMDAwMDA3LjAsInNvdXJjZSI6ImFkbWluIiwiZW1haWwiOiIiLCJleHAiOjE3NjExMjk0MDN9.GQeMVoOZ627Gi9iU7j6Cv67eJJOdLRTpvYM7yFvCTcc")
        // getInitialState()
      }
    })();
  }, [token, navigate, setToken]);

  if (loading || token) {
    return <Card loading={loading}></Card>;
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <App>
        <MessageProvider>
          <ProtectedRoute>
            <div style={{ height: '100vh' }}>
              <ProLayout
                route={{
                  routes: menuData,
                }}
                location={{
                  pathname: location.pathname,
                }}
                title="Heylync 运营管理"
                logo="https://gw.alipayobjects.com/zos/antfincdn/PmY%24TNNDBI/logo.svg"
                menuHeaderRender={(logo, title) => (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    className="h-8 gap-2"
                    onClick={() => navigate('/dashboard')}
                  >
                    <div className="h-8 w-8">{logo}</div>
                    {title}
                  </div>
                )}
                menuFooterRender={() => <UserFooter />}
                menuItemRender={(item: any, dom: React.ReactNode) => (
                  <div onClick={() => item.path && navigate(item.path)}>{dom}</div>
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
                  <Outlet />
                </div>
              </ProLayout>
            </div>
          </ProtectedRoute>
        </MessageProvider>
      </App>
    </ConfigProvider>
  );
};

export default Layout;
