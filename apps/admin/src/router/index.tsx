import { createBrowserRouter, Navigate } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import { generateRoutes, buildNestedRoutes, generateMenuItems } from '@/utils/routeUtils';
import Login from '@/pages/login';

// 生成自动路由配置
const autoRoutes = generateRoutes();
const nestedRoutes = buildNestedRoutes(autoRoutes);
const menuItems = generateMenuItems(nestedRoutes);

console.log('🚀 自动生成的路由配置:', autoRoutes);
console.log('🌳 嵌套路由结构:', nestedRoutes);
console.log('📋 生成的菜单项:', menuItems);

// 将路由配置转换为 React Router 格式
function convertRoutesToReactRouter(routes: ReturnType<typeof generateRoutes>) {
  return routes
    .filter((route) => route.path !== '/login') // 跳过 login 页面
    .map((route) => ({
      path: route.path === '/' ? undefined : route.path,
      element: <route.component />,
      index: route.path === '/', // 首页设为 index route
    }));
}

// 创建路由配置
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: <BasicLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },

      ...convertRoutesToReactRouter(autoRoutes),
    ],
  },
]);

// 导出路由配置供其他组件使用
export { autoRoutes, nestedRoutes, menuItems };
export default router;
