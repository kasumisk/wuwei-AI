import React from 'react';
import { Card, Descriptions, Button, Space, Tag, Avatar, Divider, Alert } from 'antd';
import { UserOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';

// 路由配置 - 动态路由默认隐藏在菜单中
export const routeConfig = {
  name: 'userDetail',
  title: '用户详情',
  icon: 'UserOutlined',
  requireAuth: true,
  hideInMenu: true, // 动态路由通常不在菜单中显示
};

// 用户数据类型
interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: 'active' | 'inactive';
  avatar: string;
  createdAt: string;
  lastLogin: string;
  department: string;
  position: string;
}

// 模拟用户数据
const mockUsers: Record<string, User> = {
  '1': {
    id: '1',
    name: '张三',
    email: 'zhangsan@example.com',
    phone: '138-0000-0001',
    role: '管理员',
    status: 'active',
    avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
    createdAt: '2023-01-15',
    lastLogin: '2024-01-20 10:30:00',
    department: '技术部',
    position: '前端开发工程师',
  },
  '2': {
    id: '2',
    name: '李四',
    email: 'lisi@example.com',
    phone: '138-0000-0002',
    role: '普通用户',
    status: 'inactive',
    avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
    createdAt: '2023-02-20',
    lastLogin: '2024-01-18 15:45:00',
    department: '产品部',
    position: '产品经理',
  },
  '3': {
    id: '3',
    name: '王五',
    email: 'wangwu@example.com',
    phone: '138-0000-0003',
    role: '普通用户',
    status: 'active',
    avatar: 'https://avatars.githubusercontent.com/u/3?v=4',
    createdAt: '2023-03-10',
    lastLogin: '2024-01-19 09:15:00',
    department: '设计部',
    position: 'UI/UX 设计师',
  },
};

const UserDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const user = id ? mockUsers[id] : null;

  if (!user) {
    return (
      <div>
        <Alert
          message="用户不存在"
          description={`找不到 ID 为 ${id} 的用户，请检查链接是否正确。`}
          type="error"
          showIcon
          action={
            <Button size="small" onClick={() => navigate('/user/list')}>
              返回用户列表
            </Button>
          }
          style={{ marginBottom: 16 }}
        />

        <Card title="🔗 动态路由演示">
          <p>
            这是一个动态路由页面，路径为 <code>/user/:id</code>
          </p>
          <p>
            当前请求的参数：<Tag color="blue">id = {id}</Tag>
          </p>
          <p>你可以尝试访问以下链接：</p>
          <ul>
            <li>
              <a href="/user/1">/user/1</a>
            </li>
            <li>
              <a href="/user/2">/user/2</a>
            </li>
            <li>
              <a href="/user/3">/user/3</a>
            </li>
            <li>
              <a href="/user/999">/user/999</a> (不存在的用户)
            </li>
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Card
        title={
          <Space>
            <Avatar src={user.avatar} size="large" icon={<UserOutlined />} />
            <div>
              <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{user.name}</div>
              <div style={{ fontSize: '14px', color: '#666' }}>用户详情</div>
            </div>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/user/list')}>
              返回列表
            </Button>
            <Button type="primary" icon={<EditOutlined />}>
              编辑
            </Button>
            <Button danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Space>
        }
      >
        <Descriptions title="基本信息" bordered column={2}>
          <Descriptions.Item label="用户ID">{user.id}</Descriptions.Item>
          <Descriptions.Item label="用户名">{user.name}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
          <Descriptions.Item label="手机号">{user.phone}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag color={user.role === '管理员' ? 'red' : 'blue'}>{user.role}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={user.status === 'active' ? 'green' : 'default'}>
              {user.status === 'active' ? '激活' : '未激活'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="部门">{user.department}</Descriptions.Item>
          <Descriptions.Item label="职位">{user.position}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{user.createdAt}</Descriptions.Item>
          <Descriptions.Item label="最后登录">{user.lastLogin}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Divider />

      <Card title="🚀 动态路由信息" size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Tag color="blue">路由路径：</Tag>
            <code>/user/:id</code>
          </div>
          <div>
            <Tag color="green">当前参数：</Tag>
            <code>id = {id}</code>
          </div>
          <div>
            <Tag color="orange">文件路径：</Tag>
            <code>/src/pages/user/[id].tsx</code>
          </div>
          <div>
            <Tag color="purple">路由类型：</Tag>
            <code>动态路由</code>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default UserDetailPage;
