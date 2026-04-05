

// 路由配置 - 动态路由默认隐藏在菜单中
export const routeConfig = {
  name: 'userDetail',
  title: 'example',
  icon: 'UserOutlined',
  requireAuth: true,
  hideInMenu: true, // 动态路由通常不在菜单中显示
};


export default function Page () {
    return null;
}