import React, { useState, useCallback } from 'react';
import { Tabs, theme, Dropdown, Modal } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  CloseOutlined, 
  CloseCircleOutlined, 
  ExclamationCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useTabStore } from '@/store';
import { autoRoutes } from '@/router';
import type { TabsProps, MenuProps } from 'antd';

interface TabItem {
  key: string;
  label: string;
  closable?: boolean;
}

const TabsView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeKey, addTab, removeTab, setActiveTab, removeAllTabs, removeOtherTabs } = useTabStore();
  const { token } = theme.useToken();
  const [showCloseAllModal, setShowCloseAllModal] = useState(false);

  // 从路径中提取参数的辅助函数
  const extractParamsFromPath = useCallback((actualPath: string, routePattern: string, paramNames: string[]): Record<string, string> | null => {
    try {
      // 将路由模式转换为正则表达式，捕获参数值
      const pattern = routePattern.replace(/:([^/]+)/g, '([^/]+)');
      const regex = new RegExp(`^${pattern}$`);
      const matches = actualPath.match(regex);
      
      if (matches && matches.length > 1) {
        const params: Record<string, string> = {};
        paramNames.forEach((paramName, index) => {
          if (matches[index + 1]) {
            params[paramName] = matches[index + 1];
          }
        });
        return params;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }, []);

  // 获取标签页标题的函数
  const getTabLabel = useCallback((path: string): string => {
    
    // 首先尝试精确匹配
    let route = autoRoutes.find(r => r.path === path);
    
    // 如果没有精确匹配，尝试匹配动态路由模式
    if (!route) {
      route = autoRoutes.find(r => {
        if (r.meta?.isDynamic && r.meta?.params) {
          // 将动态路由模式转换为正则表达式
          const pattern = r.path.replace(/:([^/]+)/g, '([^/]+)');
          const regex = new RegExp(`^${pattern}$`);
          return regex.test(path);
        }
        return false;
      });
    }
    
    if (route) {
      let title = route.meta?.title || route.name;
      
      // 如果是动态路由，尝试提取参数并拼接到标题
      if (route.meta?.isDynamic && route.meta?.params) {
        const pathParams = extractParamsFromPath(path, route.path, route.meta.params);
        
        if (pathParams && Object.keys(pathParams).length > 0) {
          // 获取主要参数值（通常是 ID）
          const mainParam = pathParams[route.meta.params[0]];
          if (mainParam) {
            // 根据路由类型智能生成标题
            title = enhanceTabTitle(title, mainParam);
          }
        }
      }
      
      return title;
    }
    
    const result = path.split('/').pop() || path;
    return result;
  }, [extractParamsFromPath]);

  // 增强标题显示的辅助函数
  const enhanceTabTitle = (baseTitle: string, paramValue: string): string => {
    // 根据路径类型决定如何显示参数
    return `${baseTitle} ${paramValue}`;
  };

  // 当路由改变时，自动添加标签页
  React.useEffect(() => {
    const currentPath = location.pathname;
    
    // 根据路径生成标签页信息
    const tabLabel = getTabLabel(currentPath);
    
    if (tabLabel && currentPath !== '/login') {
      addTab({
        key: currentPath,
        label: tabLabel,
        path: currentPath,
        closable: currentPath !== '/dashboard', // 导航栏不可关闭
      });
    }
  }, [location.pathname, addTab, getTabLabel]);

  // 处理标签页切换
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    navigate(key);
  };

  // 处理标签页删除
  const handleTabEdit: TabsProps['onEdit'] = (targetKey, action) => {
    if (action === 'remove') {
      removeTab(targetKey as string);
    }
  };

  // 右键菜单项
  const getContextMenuItems = (tabKey: string): MenuProps['items'] => {
    const currentTab = tabs.find(tab => tab.key === tabKey);
    const isCurrentTab = tabKey === activeKey;
    const canClose = currentTab?.closable !== false;
    const hasOtherTabs = tabs.length > 1;
    const hasClosableTabs = tabs.some(tab => tab.closable !== false);

    return [
      {
        key: 'reload',
        icon: <ReloadOutlined />,
        label: '刷新页面',
        onClick: () => {
          if (isCurrentTab) {
            window.location.reload();
          } else {
            setActiveTab(tabKey);
            navigate(tabKey);
            setTimeout(() => window.location.reload(), 100);
          }
        },
      },
      {
        type: 'divider',
      },
      {
        key: 'close',
        icon: <CloseOutlined />,
        label: '关闭标签',
        disabled: !canClose,
        onClick: () => {
          if (canClose) {
            removeTab(tabKey);
          }
        },
      },
      {
        key: 'close-others',
        icon: <CloseCircleOutlined />,
        label: '关闭其他标签',
        disabled: !hasOtherTabs || !hasClosableTabs,
        onClick: () => {
          if (hasOtherTabs) {
            removeOtherTabs(tabKey);
            setActiveTab(tabKey);
            navigate(tabKey);
          }
        },
      },
      {
        key: 'close-all',
        icon: <CloseCircleOutlined />,
        label: '关闭全部标签',
        disabled: !hasClosableTabs,
        onClick: () => {
          if (hasClosableTabs) {
            setShowCloseAllModal(true);
          }
        },
      },
    ];
  };

  // 处理关闭全部标签的确认
  const handleCloseAllConfirm = () => {
    removeAllTabs();
    setShowCloseAllModal(false);
    navigate('/dashboard'); // 关闭所有标签后跳转到首页
  };

  // 处理取消关闭全部标签
  const handleCloseAllCancel = () => {
    setShowCloseAllModal(false);
  };

  // 如果没有标签页，不显示
  if (tabs.length === 0) {
    return null;
  }

  const items = tabs.map((tab: TabItem) => ({
    key: tab.key,
    label: (
      <Dropdown
        menu={{ items: getContextMenuItems(tab.key) }}
        trigger={['contextMenu']}
      >
        <span style={{ display: 'block', fontSize: 12 }}>
          {tab.label}
        </span>
      </Dropdown>
    ),
    closable: tab.closable,

  }));

  // 根据主题模式动态设置样式
  const tabsStyle: React.CSSProperties = {
    margin: 0,
    backgroundColor: token.colorBgContainer,
    marginTop: 10,
    // borderBottom: `1px solid ${token.colorBorderSecondary}`,
    // paddingLeft: 16,
    // paddingRight: 16,
  };

  return (
    <>
      <style>
        {`
          .custom-tabs .ant-tabs-tab {
            padding: 8px !important;
          }
        `}
      </style>
      <div style={tabsStyle}>
        <Tabs
          type="editable-card"
          activeKey={activeKey}
          onChange={handleTabChange}
          onEdit={handleTabEdit}
          hideAdd
          items={items}
          style={{
            margin: 0,
            backgroundColor: 'transparent',
          }}
          tabBarStyle={{
            margin: 0,
            backgroundColor: 'transparent',
          }}
          className="custom-tabs"
        />
      </div>

      {/* 关闭全部标签确认对话框 */}
      <Modal
        title={
          <span style={{ color: token.colorWarning }}>
            <ExclamationCircleOutlined style={{ marginRight: 8 }} />
            确认关闭全部标签
          </span>
        }
        open={showCloseAllModal}
        onOk={handleCloseAllConfirm}
        onCancel={handleCloseAllCancel}
        okText="确认关闭"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要关闭所有标签页吗？这将关闭除了导航栏以外的所有页面。</p>
      </Modal>
    </>
  );
};

export default TabsView;