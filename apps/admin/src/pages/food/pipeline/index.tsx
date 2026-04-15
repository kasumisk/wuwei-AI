// 路由配置
export const routeConfig = {
  name: 'food-pipeline',
  title: '数据管道',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
  roles: ['admin', 'super_admin'],
  permissions: [],
};

// 子级路由占位
const FoodPipelineLayout: React.FC = () => {
  return null;
};

export default FoodPipelineLayout;
