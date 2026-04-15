// 路由配置
export const routeConfig = {
  name: 'food',
  title: '食物数据',
  icon: 'CoffeeOutlined',
  order: 10,
  requireAuth: true,
  requireAdmin: false,
  roles: [],
  permissions: [],
};

// 父级路由占位
const FoodLayout: React.FC = () => {
  return null;
};

export default FoodLayout;
