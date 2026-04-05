import { ApiOutlined } from '@ant-design/icons';

// 路由配置
export const routeConfig = {
  name: 'CapabilityManagement',
  title: '能力管理',
  icon: <ApiOutlined />,
  order: 3,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};
export default function Page() {
  return null;
}
