// 路由配置
export const routeConfig = {
  name: 'food-library',
  title: '食物库',
  order: 1,
  requireAuth: true,
  requireAdmin: false,
  roles: [],
  permissions: [],
};

// 子级路由占位
const FoodLibraryLayout: React.FC = () => {
  return null;
};

export default FoodLibraryLayout;
