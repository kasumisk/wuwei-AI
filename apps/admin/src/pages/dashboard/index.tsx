
// 路由配置
export const routeConfig = {
  name: 'dashboard',
  title: '仪表盘',
  icon: 'DashboardOutlined',
  order: 0,
  requireAuth: false,
  requireAdmin: false, // 不需要管理员权限
  roles: [], // 允许的角色，空数组表示不限制
  permissions: [], // 允许的权限，空数组表示不限制
};

const Dashboard = () => {

  return (
    <div>

      dashborad
    </div>
  )
};

export default Dashboard;