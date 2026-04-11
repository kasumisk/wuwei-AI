import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useUserStore } from '@/store';
import authApi from '@/services/authService';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, token, setToken, setUser, logout } = useUserStore();
  const location = useLocation();
  const [isInitialized, setIsInitialized] = useState(false);
  const initRef = useRef(false);

  // 验证 token 的有效性
  const validateToken = useCallback(async () => {
    try {
      const userInfo = await authApi.getUserInfo();
      setUser(userInfo);
      return true;
    } catch (error) {
      console.error('Token validation failed:', error);
      logout();
      return false;
    }
  }, [setUser, logout]);

  // 只在首次挂载时执行一次认证初始化
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initializeAuth = async () => {
      // 检查 URL 中是否有 token 参数
      const searchParams = new URLSearchParams(window.location.search);
      const queryToken = searchParams.get('token');

      if (queryToken) {
        // URL 中有 token，使用它
        setToken(queryToken);

        // 清除 URL 中的 token 参数
        searchParams.delete('token');
        const newUrl = `${window.location.pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
        window.history.replaceState({}, '', newUrl);

        // 验证新 token
        await validateToken();
      } else if (token && !user) {
        // 有 token 但无用户信息，验证 token
        await validateToken();
      }

      setIsInitialized(true);
    };

    initializeAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 首次初始化完成前，显示 loading（仅此一次）
  if (!isInitialized) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
        }}
      >
        <Spin size="large" tip="验证登录状态..." />
      </div>
    );
  }

  // 如果没有登录，重定向到登录页
  if (!user || !token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
