import { Card, Table, Button, Space, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

// 路由配置
export const routeConfig = {
  name: 'userList',
  title: '用户列表',
  icon: 'user',
  requireAuth: true,
};

const UserList = () => {
  const navigate = useNavigate();

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '活跃' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: { id: number }) => (
        <Space size="middle">
          <Button 
            type="link" 
            icon={<EyeOutlined />}
            onClick={() => navigate(`/example/user/${record.id}`)}
          >
            查看详情
          </Button>
          <Button type="link" icon={<EditOutlined />}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const data = [
    {
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      status: 'active',
    },
    {
      id: 2,
      username: 'user1',
      email: 'user1@example.com',
      status: 'active',
    },
    {
      id: 3,
      username: 'user2',
      email: 'user2@example.com',
      status: 'inactive',
    },
  ];

  return (
    <Card
      title="用户列表"
      extra={
        <Button type="primary" icon={<PlusOutlined />}>
          新增用户
        </Button>
      }
    >
      <Table columns={columns} dataSource={data} rowKey="id" />
    </Card>
  );
};

export default UserList;