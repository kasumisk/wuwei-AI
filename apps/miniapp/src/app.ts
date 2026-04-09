import React, { useEffect } from 'react';
import { useDidShow, useDidHide } from '@tarojs/taro';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/queryClient';
import { useAuthStore } from './store/auth';
// UnoCSS
import 'virtual:uno.css';
// 全局样式
import './app.scss';

function App(props) {
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    restore();
  }, []);

  // 对应 onShow
  useDidShow(() => {});

  // 对应 onHide
  useDidHide(() => {});

  return React.createElement(QueryClientProvider, { client: queryClient }, props.children);
}

export default App;
