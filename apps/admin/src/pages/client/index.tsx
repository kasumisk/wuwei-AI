import { TeamOutlined } from '@ant-design/icons';

// 路由配置
export const routeConfig = {
  name: 'ClientManagement',
  title: '客户端管理',
  icon: <TeamOutlined />,
  order: 2,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};

export default function Page() {
  return null;
}
