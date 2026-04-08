// 路由配置
export const routeConfig = {
  name: 'food-library',
  title: '食物库管理',
  icon: 'CoffeeOutlined',
  order: 10,
  requireAuth: true,
  requireAdmin: false,
  roles: [],
  permissions: [],
};

// 父级路由占位
const FoodLibraryLayout: React.FC = () => {
  return null;
};

export default FoodLibraryLayout;
