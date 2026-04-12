// 路由配置
export const routeConfig = {
  name: 'food-pipeline',
  title: '食物数据管道',
  icon: 'ThunderboltOutlined',
  order: 11,
  requireAuth: true,
  requireAdmin: true,
  roles: ['admin', 'super_admin'],
  permissions: [],
};

// 父级路由占位
const FoodPipelineLayout: React.FC = () => {
  return null;
};

export default FoodPipelineLayout;
