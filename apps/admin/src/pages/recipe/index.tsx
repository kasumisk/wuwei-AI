import { CoffeeOutlined } from '@ant-design/icons';

export const routeConfig = {
  name: 'recipe',
  title: '食谱管理',
  icon: <CoffeeOutlined />,
  order: 7,
  requireAuth: true,
};

export default function RecipeLayout() {
  return null;
}
