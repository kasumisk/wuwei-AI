// 路由配置
export const routeConfig = {
  name: 'food',
  title: '用户列表',
  icon: 'UserOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: false,
  roles: [],
  permissions: [],
};

// 父级路由占位
const UserLayout: React.FC = () => {
  return null;
};

export default UserLayout;
