import { useCallback, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTabStore } from '@/store';
import { KeepAliveRefContext } from '@/layouts/BasicLayout';

/**
 * 关闭当前标签页并跳转到目标路径。
 * 同时销毁 KeepAlive 缓存，防止内存泄漏。
 *
 * @example
 * const closeTabAndGo = useCloseTab();
 * closeTabAndGo('/food-library/list');
 */
export function useCloseTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const { removeTab } = useTabStore();
  const aliveRef = useContext(KeepAliveRefContext);

  return useCallback(
    (targetPath: string) => {
      const currentPath = location.pathname;
      removeTab(currentPath);
      // 销毁当前页面的 KeepAlive 缓存
      aliveRef?.current?.destroy(currentPath);
      navigate(targetPath);
    },
    [location.pathname, removeTab, navigate, aliveRef]
  );
}
