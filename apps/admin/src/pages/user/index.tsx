import React, { useState, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Modal,
  Form,
  Input,
  Select,
  Row,
  Col,
  Statistic,
  Avatar,
  Tooltip,
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  StopOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  UserOutlined,
  BarChartOutlined,
  GoogleOutlined,
  MailOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  useUpdateAppUser,
  useBanAppUser,
  useUnbanAppUser,
  useDeleteAppUser,
  useAppUserStatistics,
  appUserApi,
  type AppUserDto,
  type AppUserStatus,
} from '@/services/appUserManagementService';

// ==================== 常量配置 ====================

const authTypeConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
  anonymous: { color: 'default', icon: <UserOutlined />, text: '匿名' },
  google: { color: 'blue', icon: <GoogleOutlined />, text: 'Google' },
  email: { color: 'purple', icon: <MailOutlined />, text: '邮箱' },
};

const statusConfig: Record<AppUserStatus, { color: string; text: string }> = {
  active: { color: 'success', text: '正常' },
  inactive: { color: 'default', text: '未激活' },
  banned: { color: 'error', text: '已封禁' },
};

// ==================== 主组件 ====================

const AppUserManagement: React.FC = () => {
  const [editingUser, setEditingUser] = useState<AppUserDto | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const actionRef = useRef<ActionType>(null);
  const [editForm] = Form.useForm();

  // API Hooks
  const updateMutation = useUpdateAppUser({
    onSuccess: () => {
      message.success('更新成功');
      setEditModalVisible(false);
      setEditingUser(null);
      editForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`更新失败: ${error.message}`),
  });

  const banMutation = useBanAppUser({
    onSuccess: () => {
      message.success('已封禁该用户');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`封禁失败: ${error.message}`),
  });

  const unbanMutation = useUnbanAppUser({
    onSuccess: () => {
      message.success('已解封该用户');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`解封失败: ${error.message}`),
  });

  const deleteMutation = useDeleteAppUser({
    onSuccess: () => {
      message.success('已删除该用户');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`删除失败: ${error.message}`),
  });

  const { data: stats } = useAppUserStatistics({ enabled: statsVisible });

  // ==================== 事件处理 ====================

  const handleEdit = (record: AppUserDto) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      nickname: record.nickname,
      email: record.email,
      status: record.status,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    const values = await editForm.validateFields();
    if (!editingUser) return;
    updateMutation.mutate({ id: editingUser.id, data: values });
  };

  const handleBan = (record: AppUserDto) => {
    Modal.confirm({
      title: '确认封禁',
      content: `确定要封禁用户「${record.nickname || record.email || record.id}」吗？封禁后该用户无法登录。`,
      okText: '确认封禁',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => banMutation.mutate(record.id),
    });
  };

  const handleUnban = (record: AppUserDto) => {
    Modal.confirm({
      title: '确认解封',
      content: `确定要解封用户「${record.nickname || record.email || record.id}」吗？`,
      okText: '确认解封',
      cancelText: '取消',
      onOk: () => unbanMutation.mutate(record.id),
    });
  };

  // ==================== 表格列定义 ====================

  const columns: ProColumns<AppUserDto>[] = [
    {
      title: '用户',
      dataIndex: 'nickname',
      fixed: 'left',
      width: 200,
      render: (_: any, record: AppUserDto) => (
        <Space>
          <Avatar
            size={32}
            src={record.avatar}
            icon={<UserOutlined />}
            style={{ flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 500, lineHeight: 1.4 }}>
              {record.nickname || <span style={{ color: '#bbb' }}>无昵称</span>}
            </div>
            <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
              <Tooltip title={record.id}>
                {record.id.slice(0, 8)}...
              </Tooltip>
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      ellipsis: true,
      render: (_: any, record: AppUserDto) =>
        record.email ? (
          <Space size={4}>
            <span>{record.email}</span>
            {record.emailVerified && (
              <Tooltip title="邮箱已验证">
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>—</span>
        ),
    },
    {
      title: '登录方式',
      dataIndex: 'authType',
      width: 110,
      valueType: 'select',
      valueEnum: {
        anonymous: { text: '匿名' },
        google: { text: 'Google' },
        email: { text: '邮箱' },
      },
      render: (_: any, record: AppUserDto) => {
        const cfg = authTypeConfig[record.authType] || { color: 'default', icon: null, text: record.authType };
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        active: { text: '正常', status: 'Success' },
        inactive: { text: '未激活', status: 'Default' },
        banned: { text: '已封禁', status: 'Error' },
      },
      render: (_: any, record: AppUserDto) => {
        const cfg = statusConfig[record.status];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      render: (_: any, record: AppUserDto) =>
        record.lastLoginAt
          ? new Date(record.lastLoginAt).toLocaleString('zh-CN')
          : <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 200,
      search: false,
      render: (_: any, record: AppUserDto) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          {record.status === 'banned' ? (
            <Button
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              style={{ color: '#52c41a' }}
              onClick={() => handleUnban(record)}
              loading={unbanMutation.isPending}
            >
              解封
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<StopOutlined />}
              danger
              onClick={() => handleBan(record)}
              loading={banMutation.isPending}
            >
              封禁
            </Button>
          )}
          <Popconfirm
            title="确定要删除该用户吗？"
            description="删除后不可恢复，用户的所有数据将被清除。"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="确定删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ==================== 渲染 ====================

  return (
    <Card>
      <ProTable<AppUserDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="App 用户管理"
        columns={columns}
        scroll={{ x: 1200 }}
        request={async (params) => {
          try {
            const { list, total } = await appUserApi.getAppUsers({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.nickname || params.email,
              authType: params.authType || undefined,
              status: params.status || undefined,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
        toolBarRender={() => [
          <Button
            key="stats"
            icon={<BarChartOutlined />}
            onClick={() => setStatsVisible(true)}
          >
            统计
          </Button>,
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 位用户`,
        }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 编辑用户弹窗 */}
      <Modal
        title={`编辑用户 — ${editingUser?.nickname || editingUser?.email || editingUser?.id}`}
        open={editModalVisible}
        onOk={handleEditSubmit}
        confirmLoading={updateMutation.isPending}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingUser(null);
          editForm.resetFields();
        }}
        width={480}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="请输入昵称" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: '正常', value: 'active' },
                { label: '未激活', value: 'inactive' },
                { label: '已封禁', value: 'banned' },
              ]}
              placeholder="请选择状态"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 统计弹窗 */}
      <Modal
        title="App 用户统计"
        open={statsVisible}
        onCancel={() => setStatsVisible(false)}
        footer={null}
        width={480}
      >
        {stats && (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
              <Col span={24}>
                <Statistic title="总用户数" value={stats.total} />
              </Col>
            </Row>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="匿名用户" value={stats.byAuthType.anonymous} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="Google 登录"
                  value={stats.byAuthType.google}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="邮箱注册"
                  value={stats.byAuthType.email}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Col>
            </Row>
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col span={12}>
                <Statistic
                  title="正常账号"
                  value={stats.byStatus.active}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="已封禁"
                  value={stats.byStatus.banned}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Col>
            </Row>
          </>
        )}
      </Modal>
    </Card>
  );
};

export default AppUserManagement;

export const routeConfig = {
  name: 'user',
  title: '用户管理',
  icon: 'UserOutlined',
  order: 5,
  requireAuth: true,
  requireAdmin: true,
};
