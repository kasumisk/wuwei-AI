import React from 'react';
import { Card, Row, Col, Statistic, Button, Space } from 'antd';
import { UserOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

// 路由配置
export const routeConfig = {
  name: 'user',
  title: '用户管理',
  icon: 'UserOutlined',
  requireAuth: true,
  hideInMenu: true,
};

const UserManagementIndex: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div>
      <Card title="用户管理概览" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={8}>
            <Card>
              <Statistic
                title="总用户数"
                value={1128}
                prefix={<UserOutlined />}
                valueStyle={{ color: '#3f8600' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic
                title="活跃用户"
                value={893}
                prefix={<TeamOutlined />}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic
                title="新增用户"
                value={28}
                prefix={<UserAddOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
        </Row>
      </Card>

      <Card title="快速操作">
        <Space>
          <Button 
            type="primary" 
            icon={<UserOutlined />}
            onClick={() => navigate('/user/list')}
          >
            查看用户列表
          </Button>
          <Button 
            icon={<UserAddOutlined />}
            onClick={() => navigate('/user/form')}
          >
            新增用户
          </Button>
          <Button 
            icon={<TeamOutlined />}
            onClick={() => navigate('/user/management')}
          >
            用户管理(Query版本)
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default UserManagementIndex;