import React, { useState } from 'react';
import { Avatar, Dropdown, Space, Typography, Modal, Switch } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  ExclamationCircleOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useUserStore, useThemeStore } from '@/store';
import type { MenuProps } from 'antd';

const { Text } = Typography;

interface UserFooterProps {
  collapsed?: boolean;
}

const UserFooter: React.FC<UserFooterProps> = ({ collapsed = false }) => {
  const { user, logout } = useUserStore();
  const { mode, setMode } = useThemeStore();
  const navigate = useNavigate();
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleThemeToggle = (checked: boolean) => {
    setMode(checked ? 'dark' : 'light');
  };

  const showLogoutModal = () => {
    setLogoutModalVisible(true);
  };

  const handleLogoutConfirm = () => {
    setLogoutModalVisible(false);
    handleLogout();
  };

  const handleLogoutCancel = () => {
    setLogoutModalVisible(false);
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'theme',
      icon: mode === 'dark' ? <SunOutlined /> : <MoonOutlined />,
      label: (
        <div className="flex items-center justify-between w-full">
          <span>深色主题</span>
          <Switch
            checked={mode === 'dark'}
            onChange={handleThemeToggle}
            size="small"
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
          />
        </div>
      ),
      onClick: (e) => {
        e.domEvent.stopPropagation();
      },
    },
    {
      type: 'divider',
    },
    // {
    //   key: 'profile',
    //   icon: <UserOutlined />,
    //   label: '个人中心',
    //   onClick: () => navigate('/profile'),
    // },
    // {
    //   key: 'settings',
    //   icon: <SettingOutlined />,
    //   label: '个人设置',
    //   onClick: () => navigate('/settings'),
    // },
    // {
    //   type: 'divider',
    // },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: showLogoutModal,
    },
  ];

  if (!user) {
    return null;
  }

  return (
    <>
      <div className="user-footer-container theme-transition">
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="topLeft">
          <div
            className={`
              flex items-center cursor-pointer w-full rounded-lg p-2 
              hover:bg-opacity-50 transition-colors
              ${collapsed ? 'justify-center' : 'gap-2'}
            `}
            style={{
              backgroundColor:
                mode === 'dark' ? 'rgba(55, 65, 81, 0.5)' : 'rgba(249, 250, 251, 0.5)',
            }}
          >
            <Avatar
              size={collapsed ? 32 : 36}
              src={'avatar' in user ? (user as unknown as { avatar?: string }).avatar : undefined}
              icon={<UserOutlined />}
              style={{ backgroundColor: '#3b82f6' }}
            />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div>
                  <Text
                    strong
                    className="user-info-text text-sm block overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    {('name' in user ? (user as unknown as { name?: string }).name : undefined) ||
                      user.username ||
                      '用户'}
                  </Text>
                  {user.role && (
                    <Text className="user-role-text text-xs block overflow-hidden text-ellipsis whitespace-nowrap">
                      {user.role}
                    </Text>
                  )}
                </div>
              </div>
            )}
          </div>
        </Dropdown>
      </div>

      <Modal
        title={
          <Space style={{ color: mode === 'dark' ? '#f59e0b' : '#f59e0b' }}>
            <ExclamationCircleOutlined />
            确认退出
          </Space>
        }
        open={logoutModalVisible}
        onOk={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
        okText="确认退出"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p
          style={{
            color: mode === 'dark' ? 'rgb(209, 213, 219)' : 'rgb(55, 65, 81)',
          }}
        >
          确定要退出当前账户吗？
        </p>
      </Modal>
    </>
  );
};

export default UserFooter;
