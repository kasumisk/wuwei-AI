import React, { useEffect, useState, useCallback } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Spin } from 'antd';
import { useUserStore } from '@/store';
import authApi from '@/services/authService';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, token, setToken, setUser, logout } = useUserStore();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [isValidating, setIsValidating] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasValidatedInSession, setHasValidatedInSession] = useState(false);

  const queryToken = searchParams.get('token');

  // 验证 token 的有效性
  const validateToken = useCallback(async () => {
    try {
      setIsValidating(true);
      const userInfo = await authApi.getUserInfo();
      setUser(userInfo);
      setHasValidatedInSession(true); // 标记本次会话已验证过
      return true;
    } catch (error) {
      console.error('Token validation failed:', error);
      // Token 无效，清除所有登录信息
      logout();
      setHasValidatedInSession(true); // 即使失败也标记为已验证，避免重复验证
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [setUser, logout]);

  useEffect(() => {
    // 如果本次会话已经验证过，直接初始化完成
    if (hasValidatedInSession) {
      setIsInitialized(true);
      return;
    }

    const initializeAuth = async () => {
      // 1. 如果 URL 中有 token 参数，优先使用它
      if (queryToken) {
        console.log('Found token in query params, setting new token');
        setToken(queryToken);
        
        // 清除 URL 中的 token 参数
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('token');
        const newUrl = `${location.pathname}${newSearchParams.toString() ? '?' + newSearchParams.toString() : ''}`;
        window.history.replaceState({}, '', newUrl);
        
        // 验证新 token
        await validateToken();
      }
      // 2. 如果已有 token 且用户信息不存在，验证其有效性
      else if (token && !user) {
        await validateToken();
      } else {
        // 没有 token 或已有用户信息，直接标记为已验证
        setHasValidatedInSession(true);
      }
      
      setIsInitialized(true);
    };

    initializeAuth();
  }, [queryToken, token, user, setToken, validateToken, hasValidatedInSession, searchParams, location.pathname]);

  // 正在验证 token 时显示加载状态
  if (!isInitialized || isValidating) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
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