export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/analyze/index',
    'pages/coach/index',
    'pages/foods/index',
    'pages/profile/index',
    'pages/login/index',
    'pages/foods/detail',
    'pages/records/index',
    'pages/health-profile/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'uWay',
    navigationBarTextStyle: 'black',
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#1890ff',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png',
      },
      {
        pagePath: 'pages/analyze/index',
        text: '分析',
        iconPath: 'assets/tab-analyze.png',
        selectedIconPath: 'assets/tab-analyze-active.png',
      },
      {
        pagePath: 'pages/coach/index',
        text: 'AI教练',
        iconPath: 'assets/tab-coach.png',
        selectedIconPath: 'assets/tab-coach-active.png',
      },
      {
        pagePath: 'pages/foods/index',
        text: '食物库',
        iconPath: 'assets/tab-food.png',
        selectedIconPath: 'assets/tab-food-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tab-profile.png',
        selectedIconPath: 'assets/tab-profile-active.png',
      },
    ],
  },
});
