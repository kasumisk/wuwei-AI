import React, { useState, useRef, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Modal,
  Checkbox,
  Spin,
  Alert,
  Typography,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  GoogleOutlined,
  UserOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import ConfigurableProForm from '@/components/ProForm';
import { Permission } from '@/components/Permission';
import type { FormConfig } from '@/types/form';
import {
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useUserRoles,
  useAssignUserRoles,
  userApi,
  type UserInfoDto,
} from '@/services/userService';
import { useRoles } from '@/services/roleService';

const { Text } = Typography;

// 路由配置
export const routeConfig = {
  name: 'UserManagement',
  title: '管理员白名单',
  icon: <UserOutlined />,
  order: 1,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};

type User = UserInfoDto;

const UserManagement: React.FC = () => {
  const [currentRecord, setCurrentRecord] = useState<User | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const actionRef = useRef<ActionType>(null);

  // 获取所有角色
  const { data: rolesData } = useRoles({ pageSize: 100 });

  // 获取选中用户的角色
  const { data: userRolesData, isLoading: isLoadingUserRoles } = useUserRoles(
    currentRecord?.id || '',
    {
      enabled: !!currentRecord?.id && isRoleModalVisible,
    }
  );

  // 当用户角色数据加载完成后，设置选中的角色
  useEffect(() => {
    if (userRolesData?.roles) {
      setSelectedRoleIds(userRolesData.roles.map((r) => r.id));
    }
  }, [userRolesData]);

  // API hooks
  const createMutation = useCreateUser({
    onSuccess: () => {
      message.success('创建成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`创建失败: ${error.message}`);
    },
  });

  const updateMutation = useUpdateUser({
    onSuccess: () => {
      message.success('更新成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`更新失败: ${error.message}`);
    },
  });

  const deleteMutation = useDeleteUser({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`删除失败: ${error.message}`);
    },
  });

  // 分配角色
  const assignRolesMutation = useAssignUserRoles({
    onSuccess: () => {
      message.success('角色分配成功');
      setIsRoleModalVisible(false);
      setCurrentRecord(null);
      setSelectedRoleIds([]);
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`角色分配失败: ${error.message}`);
    },
  });

  // 事件处理函数
  const handleCreate = () => {
    setIsEditMode(false);
    setCurrentRecord(null);
    setModalVisible(true);
  };

  const handleEdit = (record: User) => {
    setIsEditMode(true);
    setCurrentRecord(record);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    if (isEditMode && currentRecord) {
      updateMutation.mutate({ id: currentRecord.id, data: values });
    } else {
      (createMutation.mutate as any)(values);
    }
  };

  // 打开角色分配弹窗
  const showRoleModal = (user: User) => {
    setCurrentRecord(user);
    setSelectedRoleIds([]);
    setIsRoleModalVisible(true);
  };

  // 保存角色分配
  const handleSaveRoles = () => {
    if (!currentRecord) return;
    assignRolesMutation.mutate({
      id: currentRecord.id,
      roleIds: selectedRoleIds,
    });
  };

  // 处理角色选择变化
  const handleRoleChange = (roleId: string, checked: boolean) => {
    if (checked) {
      setSelectedRoleIds([...selectedRoleIds, roleId]);
    } else {
      setSelectedRoleIds(selectedRoleIds.filter((id) => id !== roleId));
    }
  };

  // 表格列定义
  const columns: ProColumns<User>[] = [
    {
      title: '用户名',
      dataIndex: 'username',
      fixed: 'left',
      width: 120,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      width: 120,
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      width: 140,
      search: false,
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 200,
      valueType: 'select',
      valueEnum: {
        '': { text: '全部' },
        admin: { text: '管理员' },
        super_admin: { text: '超级管理员' },
      },
      render: (_: any, record: UserInfoDto) => {
        // 优先显示 RBAC 角色
        if (record.rbacRoles && record.rbacRoles.length > 0) {
          return (
            <Space wrap>
              {record.rbacRoles.map((role) => (
                <Tag key={role.id} color="blue">
                  {role.name}
                </Tag>
              ))}
            </Space>
          );
        }
        // 兼容旧角色字段
        return (
          <Tag color={record.role === 'super_admin' ? 'gold' : 'blue'}>
            {record.role === 'super_admin' ? '超级管理员' : '管理员'}
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
        '': { text: '全部' },
        active: { text: '正常' },
        inactive: { text: '未激活' },
        suspended: { text: '已停用' },
      },
      render: (_: any, record: UserInfoDto) => {
        const colorMap: any = {
          active: 'green',
          inactive: 'default',
          suspended: 'red',
        };
        const textMap: any = {
          active: '正常',
          inactive: '未激活',
          suspended: '已停用',
        };
        return <Tag color={colorMap[record.status]}>{textMap[record.status]}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 280,
      search: false,
      render: (_: any, record: User) => (
        <Space size="small">
          <Permission permissions="user:update">
            <Button
              type="primary"
              size="small"
              icon={<TeamOutlined />}
              onClick={() => showRoleModal(record)}
            >
              分配角色
            </Button>
          </Permission>
          <Permission permissions="user:update">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            >
              编辑
            </Button>
          </Permission>
          <Permission permissions="user:delete">
            <Popconfirm
              title="确定要删除该用户吗？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.username === 'admin'}
                loading={deleteMutation.isPending}
              >
                删除
              </Button>
            </Popconfirm>
          </Permission>
        </Space>
      ),
    },
  ];

  // 表单配置
  const formConfig: FormConfig = {
    title: isEditMode ? '编辑管理员白名单' : '新增管理员白名单',
    layout: 'vertical',
    fields: [
      ...(isEditMode
        ? []
        : [
            {
              name: 'username',
              label: '用户名',
              type: 'text' as const,
              fieldProps: {
                placeholder: '可选，不填时按邮箱自动生成',
              },
            },
          ]),
      {
        name: 'email',
        label: 'Google 邮箱',
        type: 'text',
        required: true,
        fieldProps: {
          placeholder: '请输入允许登录后台的 Google 邮箱',
        },
      },
      {
        name: 'nickname',
        label: '昵称',
        type: 'text',
        fieldProps: {
          placeholder: '请输入昵称',
        },
      },
      {
        name: 'phone',
        label: '手机号',
        type: 'text',
        fieldProps: {
          placeholder: '请输入手机号',
        },
      },
      {
        name: 'role',
        label: '角色',
        type: 'select',
        required: true,
        options: [
          { label: '管理员', value: 'admin' },
          { label: '超级管理员', value: 'super_admin' },
        ],
        fieldProps: {
          placeholder: '请选择角色',
        },
      },
      {
        name: 'status',
        label: '白名单状态',
        type: 'select' as const,
        required: true,
        options: [
          { label: '正常，可登录后台', value: 'active' },
          { label: '未激活，暂不放行', value: 'inactive' },
          { label: '已停用，拒绝登录', value: 'suspended' },
        ],
        fieldProps: {
          placeholder: '请选择状态',
        },
      },
    ],
  };

  return (
    <Card>
      <Alert
        type="info"
        showIcon
        icon={<GoogleOutlined />}
        style={{ marginBottom: 16 }}
        message="后台已切换为 Firebase Google 登录"
        description="这里的管理员记录就是后台白名单。邮箱命中且状态为“正常”的 Google 账号，才能登录后台。"
      />
      <ProTable<User>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="管理员白名单"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await userApi.getUsers({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.username || params.email || params.nickname,
              role: params.role,
              status: params.status,
            });

            return {
              data: list || [],
              total: total || 0,
              success: true,
            };
          } catch (error) {
            console.error('获取数据失败:', error);
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
          <Permission key="create-permission" permissions="user:create">
            <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增白名单
            </Button>
          </Permission>,
        ]}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
        }}
      />

      {/* 新增/编辑表单 */}
      <ConfigurableProForm
        config={formConfig}
        mode="drawer"
        visible={modalVisible}
        onVisibleChange={setModalVisible}
        initialValues={(currentRecord ? { ...currentRecord } : {}) as Record<string, any>}
        onFinish={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
        width={500}
      />

      {/* 角色分配弹窗 */}
      <Modal
        title={
          <Space>
            <TeamOutlined />
            <span>分配角色 - {currentRecord?.username}</span>
          </Space>
        }
        open={isRoleModalVisible}
        onOk={handleSaveRoles}
        onCancel={() => {
          setIsRoleModalVisible(false);
          setCurrentRecord(null);
          setSelectedRoleIds([]);
        }}
        confirmLoading={assignRolesMutation.isPending}
        width={500}
      >
        <Alert
          type="info"
          message="为用户分配角色后，用户将获得对应角色的所有权限"
          style={{ marginBottom: 16 }}
        />

        {isLoadingUserRoles ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Spin />
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {rolesData?.list && rolesData.list.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rolesData.list.map((role) => (
                  <div
                    key={role.id}
                    style={{
                      padding: '12px 16px',
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      backgroundColor: selectedRoleIds.includes(role.id) ? '#f6ffed' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                    }}
                    onClick={() => handleRoleChange(role.id, !selectedRoleIds.includes(role.id))}
                  >
                    <Checkbox
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={(e) => handleRoleChange(role.id, e.target.checked)}
                    >
                      <Space>
                        <Text strong>{role.name}</Text>
                        <Tag color="blue">{role.code}</Tag>
                        {role.isSystem && <Tag color="orange">系统角色</Tag>}
                      </Space>
                    </Checkbox>
                    {role.description && (
                      <div style={{ marginLeft: 24, marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {role.description}
                        </Text>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
                暂无可分配的角色，请先在权限管理中创建角色
              </div>
            )}
          </div>
        )}

        <Divider style={{ margin: '16px 0' }} />
        <div>
          <Text type="secondary">
            已选择 <Text strong>{selectedRoleIds.length}</Text> 个角色
          </Text>
        </div>
      </Modal>
    </Card>
  );
};

export default UserManagement;
