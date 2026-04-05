// 路由配置
export const routeConfig = {
  name: 'dashboard',
  title: '系统管理',
  icon: 'SettingOutlined',
  order: 998,
  requireAuth: false,
  requireAdmin: false, // 不需要管理员权限
  roles: [], // 允许的角色，空数组表示不限制
  permissions: [], // 允许的权限，空数组表示不限制
};

// ==================== 角色管理 Tab ====================
const SystemManagement: React.FC = () => {
  return null;
};

export default SystemManagement;
