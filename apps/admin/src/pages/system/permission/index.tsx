import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Tree,
  Tabs,
  Drawer,
  Form,
  Select,
  InputNumber,
  Input,
  Modal,
  Alert,
  Divider,
  Typography,
  Row,
  Col,
  type TreeDataNode,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SafetyOutlined,
  ReloadOutlined,
  TeamOutlined,
  KeyOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  useRoleTree,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useRolePermissions,
  useAssignPermissions,
  useApplyTemplate,
  roleApi,
  type RoleInfoDto,
} from '@/services/roleService';
import {
  useRbacPermissions,
  useRbacPermissionTree,
  useCreateRbacPermission,
  useUpdateRbacPermission,
  useDeleteRbacPermission,
  rbacPermissionApi,
  type RbacPermissionInfoDto,
} from '@/services/rbacPermissionService';
import {
  usePermissionTemplates,
  useCreatePermissionTemplate,
  useUpdatePermissionTemplate,
  useDeletePermissionTemplate,
  usePreviewTemplate,
  permissionTemplateApi,
  type PermissionTemplateInfoDto,
} from '@/services/permissionTemplateService';

const { Text } = Typography;

// 路由配置
export const routeConfig = {
  name: 'PermissionManagement',
  title: '权限管理',
  icon: <SafetyOutlined />,
  order: 2,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 角色管理 Tab ====================
const RoleManagement: React.FC = () => {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleInfoDto | null>(null);
  const [permissionDrawerVisible, setPermissionDrawerVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleInfoDto | null>(null);
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [templateForm] = Form.useForm();
  const actionRef = useRef<ActionType>(null);

  // 获取角色树
  const { data: roleTree, refetch: refetchRoleTree } = useRoleTree();

  // 获取权限树
  const { data: permissionTree } = useRbacPermissionTree();

  // 获取所有权限（用于全选等操作）
  const { data: allPermissions } = useRbacPermissions({ pageSize: 1000 });

  // 获取权限模板列表
  const { data: templates } = usePermissionTemplates();

  // 获取选中角色的权限
  const {
    data: rolePermissions,
    refetch: refetchRolePermissions,
  } = useRolePermissions(selectedRole?.id || '', { enabled: !!selectedRole?.id });

  // 当角色权限加载完成后，设置选中的权限
  useEffect(() => {
    if (rolePermissions?.ownPermissionIds) {
      setCheckedKeys(rolePermissions.ownPermissionIds);
    }
  }, [rolePermissions]);
  // Mutations
  const createRoleMutation = useCreateRole({
    onSuccess: () => {
      message.success('创建成功');
      setDrawerVisible(false);
      form.resetFields();
      actionRef.current?.reload();
      refetchRoleTree();
    },
    onError: (error) => message.error(`创建失败: ${error.message}`),
  });

  const updateRoleMutation = useUpdateRole({
    onSuccess: () => {
      message.success('更新成功');
      setDrawerVisible(false);
      setEditingRole(null);
      form.resetFields();
      actionRef.current?.reload();
      refetchRoleTree();
    },
    onError: (error) => message.error(`更新失败: ${error.message}`),
  });

  const deleteRoleMutation = useDeleteRole({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
      refetchRoleTree();
    },
    onError: (error) => message.error(`删除失败: ${error.message}`),
  });

  const assignPermissionsMutation = useAssignPermissions({
    onSuccess: () => {
      message.success('权限配置保存成功');
      refetchRolePermissions();
    },
    onError: (error) => message.error(`保存失败: ${error.message}`),
  });

  const applyTemplateMutation = useApplyTemplate({
    onSuccess: () => {
      message.success('模板应用成功');
      setTemplateModalVisible(false);
      templateForm.resetFields();
      refetchRolePermissions();
    },
    onError: (error) => message.error(`应用失败: ${error.message}`),
  });

  // 打开编辑抽屉
  const handleEdit = (record: RoleInfoDto) => {
    setEditingRole(record);
    form.setFieldsValue(record);
    setDrawerVisible(true);
  };

  // 打开权限配置抽屉
  const handleConfigPermissions = (role: RoleInfoDto) => {
    setSelectedRole(role);
    setPermissionDrawerVisible(true);
  };

  // 提交角色表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRole) {
        updateRoleMutation.mutate({ id: editingRole.id, data: values });
      } else {
        createRoleMutation.mutate(values);
      }
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  // 保存权限配置
  const handleSavePermissions = () => {
    if (!selectedRole) return;
    assignPermissionsMutation.mutate({
      id: selectedRole.id,
      data: { permissionIds: checkedKeys },
    });
  };

  // 应用模板
  const handleApplyTemplate = async () => {
    try {
      const values = await templateForm.validateFields();
      if (!selectedRole) return;
      applyTemplateMutation.mutate({
        id: selectedRole.id,
        data: values,
      });
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  // 将权限树转为 Tree 组件数据
  const permissionTreeData = useMemo(() => {
    const convert = (permissions: RbacPermissionInfoDto[]): TreeDataNode[] => {
      return permissions.map((p) => ({
        key: p.id,
        title: (
          <span>
            {p.name}
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {p.code}
            </Text>
            {p.type === 'operation' && (
              <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>
                操作
              </Tag>
            )}
          </span>
        ),
        children: p.children ? convert(p.children) : undefined,
        isLeaf: !p.children || p.children.length === 0,
      }));
    };
    return permissionTree ? convert(permissionTree) : [];
  }, [permissionTree]);

  // 计算继承的权限 ID
  const inheritedPermissionIds = useMemo(() => {
    return rolePermissions?.inheritedPermissionIds || [];
  }, [rolePermissions]);

  // 构建父角色选项
  const buildParentOptions = (
    roles: RoleInfoDto[] = [],
    excludeId?: string
  ): { label: string; value: string }[] => {
    const options: { label: string; value: string }[] = [];
    const flatten = (list: RoleInfoDto[], prefix = '') => {
      list.forEach((role) => {
        if (role.id !== excludeId) {
          options.push({ label: `${prefix}${role.name}`, value: role.id });
          if (role.children && role.children.length > 0) {
            flatten(role.children, `${prefix}── `);
          }
        }
      });
    };
    flatten(roles);
    return options;
  };

  // 表格列定义
  const columns: ProColumns<RoleInfoDto>[] = [
    {
      title: '角色编码',
      dataIndex: 'code',
      width: 150,
    },
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        active: { text: '启用', status: 'Success' },
        inactive: { text: '禁用', status: 'Default' },
      },
    },
    {
      title: '系统角色',
      dataIndex: 'isSystem',
      width: 100,
      search: false,
      render: (_, record) => (
        <Tag color={record.isSystem ? 'blue' : 'default'}>{record.isSystem ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 80,
      search: false,
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
      width: 240,
      search: false,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<KeyOutlined />}
            onClick={() => handleConfigPermissions(record)}
          >
            配置权限
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除该角色吗？"
            onConfirm={() => deleteRoleMutation.mutate(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.isSystem}
              loading={deleteRoleMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<RoleInfoDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="角色列表"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await roleApi.getRoles({
              page: params.current,
              pageSize: params.pageSize,
              code: params.code,
              name: params.name,
              status: params.status,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch (error) {
            console.error('获取数据失败:', error);
            return { data: [], total: 0, success: false };
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
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRole(null);
              form.resetFields();
              setDrawerVisible(true);
            }}
          >
            新增角色
          </Button>,
        ]}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />

      {/* 新增/编辑角色抽屉 */}
      <Drawer
        title={editingRole ? '编辑角色' : '新增角色'}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setEditingRole(null);
          form.resetFields();
        }}
        width={500}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={createRoleMutation.isPending || updateRoleMutation.isPending}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="角色编码"
            rules={[{ required: true, message: '请输入角色编码' }]}
          >
            <Input placeholder="请输入角色编码，如 ADMIN" disabled={!!editingRole} />
          </Form.Item>
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="请输入角色名称" />
          </Form.Item>
          <Form.Item name="parentId" label="父角色">
            <Select
              allowClear
              placeholder="选择父角色（继承其权限）"
              options={buildParentOptions(roleTree, editingRole?.id)}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="请输入描述" />
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editingRole && (
            <Form.Item name="status" label="状态" initialValue="active">
              <Select
                options={[
                  { label: '启用', value: 'active' },
                  { label: '禁用', value: 'inactive' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Drawer>

      {/* 权限配置抽屉 */}
      <Drawer
        title={
          <Space>
            <KeyOutlined />
            <span>配置权限 - {selectedRole?.name}</span>
          </Space>
        }
        open={permissionDrawerVisible}
        onClose={() => {
          setPermissionDrawerVisible(false);
          setSelectedRole(null);
          setCheckedKeys([]);
          setExpandedKeys([]);
        }}
        width={600}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setTemplateModalVisible(true)} icon={<FileTextOutlined />}>
              应用模板
            </Button>
            <Space>
              <Button onClick={() => setPermissionDrawerVisible(false)}>取消</Button>
              <Button
                type="primary"
                onClick={handleSavePermissions}
                loading={assignPermissionsMutation.isPending}
              >
                保存配置
              </Button>
            </Space>
          </div>
        }
      >
        {/* 权限统计 */}
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message={
            <Space split={<Divider type="vertical" />}>
              <span>
                自有权限: <Text strong>{checkedKeys.length}</Text>
              </span>
              <span>
                继承权限: <Text strong>{inheritedPermissionIds.length}</Text>
              </span>
              <span>
                总权限: <Text strong>{new Set([...checkedKeys, ...inheritedPermissionIds]).size}</Text>
              </span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />

        {inheritedPermissionIds.length > 0 && (
          <Alert
            type="warning"
            message="继承的权限来自父角色，无法取消勾选。如需修改，请编辑父角色的权限。"
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 权限树 */}
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Space>
              <Button
                size="small"
                onClick={() => {
                  const allKeys = allPermissions?.list.map((p) => p.id) || [];
                  setExpandedKeys(allKeys);
                }}
              >
                展开全部
              </Button>
              <Button size="small" onClick={() => setExpandedKeys([])}>
                收起全部
              </Button>
              <Button
                size="small"
                onClick={() => {
                  const allKeys = allPermissions?.list.map((p) => p.id) || [];
                  setCheckedKeys(allKeys);
                }}
              >
                全选
              </Button>
              <Button size="small" onClick={() => setCheckedKeys([])}>
                全不选
              </Button>
            </Space>
          </div>
          <Tree
            checkable
            checkStrictly
            showLine
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            checkedKeys={{
              checked: checkedKeys,
              halfChecked: inheritedPermissionIds.filter((id) => !checkedKeys.includes(id)),
            }}
            onCheck={(checked) => {
              const keys = Array.isArray(checked) ? checked : checked.checked;
              setCheckedKeys(keys as string[]);
            }}
            treeData={permissionTreeData}
            style={{ maxHeight: 500, overflow: 'auto' }}
          />
        </div>
      </Drawer>

      {/* 应用模板弹窗 */}
      <Modal
        title="应用权限模板"
        open={templateModalVisible}
        onOk={handleApplyTemplate}
        onCancel={() => {
          setTemplateModalVisible(false);
          templateForm.resetFields();
        }}
        confirmLoading={applyTemplateMutation.isPending}
      >
        <Alert
          type="info"
          message="应用模板将在现有权限基础上追加模板定义的权限"
          style={{ marginBottom: 16 }}
        />
        <Form form={templateForm} layout="vertical">
          <Form.Item
            name="templateCode"
            label="选择模板"
            rules={[{ required: true, message: '请选择模板' }]}
          >
            <Select
              placeholder="请选择权限模板"
              options={templates?.list.map((t) => ({
                label: `${t.name} (${t.code})`,
                value: t.code,
              }))}
            />
          </Form.Item>
          <Form.Item name="modules" label="应用到模块（可选）">
            <Select
              mode="multiple"
              placeholder="留空则应用到所有模块"
              options={[
                { label: '用户管理', value: 'user' },
                { label: '角色管理', value: 'role' },
                { label: '权限管理', value: 'permission' },
                { label: '客户端管理', value: 'client' },
                { label: '模型管理', value: 'model' },
                { label: '供应商管理', value: 'provider' },
                { label: '统计分析', value: 'analytics' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// ==================== 权限管理 Tab ====================
const PermissionManagement: React.FC = () => {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingPermission, setEditingPermission] = useState<RbacPermissionInfoDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);

  // 获取权限树
  const { data: permissionTree, refetch: refetchTree } = useRbacPermissionTree();

  // Mutations
  const createMutation = useCreateRbacPermission({
    onSuccess: () => {
      message.success('创建成功');
      setDrawerVisible(false);
      form.resetFields();
      actionRef.current?.reload();
      refetchTree();
    },
    onError: (error) => message.error(`创建失败: ${error.message}`),
  });

  const updateMutation = useUpdateRbacPermission({
    onSuccess: () => {
      message.success('更新成功');
      setDrawerVisible(false);
      setEditingPermission(null);
      form.resetFields();
      actionRef.current?.reload();
      refetchTree();
    },
    onError: (error) => message.error(`更新失败: ${error.message}`),
  });

  const deleteMutation = useDeleteRbacPermission({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
      refetchTree();
    },
    onError: (error) => message.error(`删除失败: ${error.message}`),
  });

  // 打开编辑抽屉
  const handleEdit = (record: RbacPermissionInfoDto) => {
    setEditingPermission(record);
    form.setFieldsValue(record);
    setDrawerVisible(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingPermission) {
        updateMutation.mutate({ id: editingPermission.id, data: values });
      } else {
        createMutation.mutate(values);
      }
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  // 构建父权限选项
  const buildParentOptions = (
    permissions: RbacPermissionInfoDto[] = [],
    excludeId?: string
  ): { label: string; value: string }[] => {
    const options: { label: string; value: string }[] = [];
    const flatten = (list: RbacPermissionInfoDto[], prefix = '') => {
      list.forEach((perm) => {
        if (perm.id !== excludeId && perm.type === 'menu') {
          options.push({ label: `${prefix}${perm.name}`, value: perm.id });
          if (perm.children && perm.children.length > 0) {
            flatten(perm.children, `${prefix}── `);
          }
        }
      });
    };
    flatten(permissions);
    return options;
  };

  // 将权限树转为 Tree 组件数据
  const convertToTreeData = (permissions: RbacPermissionInfoDto[]): TreeDataNode[] => {
    return permissions.map((p) => ({
      key: p.id,
      title: (
        <Space>
          <span>{p.name}</span>
          <Tag color={p.type === 'menu' ? 'blue' : 'green'} style={{ marginLeft: 8 }}>
            {p.type === 'menu' ? '菜单' : '操作'}
          </Tag>
          <span style={{ color: '#999', fontSize: 12 }}>({p.code})</span>
        </Space>
      ),
      children: p.children ? convertToTreeData(p.children) : undefined,
    }));
  };

  // 表格列定义
  const columns: ProColumns<RbacPermissionInfoDto>[] = [
    {
      title: '权限编码',
      dataIndex: 'code',
      width: 180,
    },
    {
      title: '权限名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      valueType: 'select',
      valueEnum: {
        menu: { text: '菜单', status: 'Processing' },
        operation: { text: '操作', status: 'Success' },
      },
    },
    {
      title: 'API方法',
      dataIndex: 'action',
      width: 100,
      search: false,
      render: (_, record) => (record.action ? <Tag color="orange">{record.action}</Tag> : '-'),
    },
    {
      title: 'API路径',
      dataIndex: 'resource',
      width: 200,
      ellipsis: true,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        active: { text: '启用', status: 'Success' },
        inactive: { text: '禁用', status: 'Default' },
      },
    },
    {
      title: '系统权限',
      dataIndex: 'isSystem',
      width: 100,
      search: false,
      render: (_, record) => (
        <Tag color={record.isSystem ? 'blue' : 'default'}>{record.isSystem ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 180,
      search: false,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除该权限吗？"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.isSystem}
              loading={deleteMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const permType = Form.useWatch('type', form);

  return (
    <>
      <Row gutter={16}>
        {/* 左侧权限树 */}
        <Col span={8}>
          <Card title="权限结构树" size="small" style={{ height: '100%' }}>
            {permissionTree && permissionTree.length > 0 ? (
              <Tree showLine defaultExpandAll treeData={convertToTreeData(permissionTree)} />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>暂无权限数据</div>
            )}
          </Card>
        </Col>

        {/* 右侧权限列表 */}
        <Col span={16}>
          <ProTable<RbacPermissionInfoDto>
            actionRef={actionRef}
            rowKey="id"
            headerTitle="权限列表"
            columns={columns}
            request={async (params) => {
              try {
                const { list, total } = await rbacPermissionApi.getRbacPermissions({
                  page: params.current,
                  pageSize: params.pageSize,
                  code: params.code,
                  name: params.name,
                  type: params.type,
                  status: params.status,
                });
                return { data: list || [], total: total || 0, success: true };
              } catch (error) {
                console.error('获取数据失败:', error);
                return { data: [], total: 0, success: false };
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
              <Button
                key="create"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingPermission(null);
                  form.resetFields();
                  setDrawerVisible(true);
                }}
              >
                新增权限
              </Button>,
            ]}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          />
        </Col>
      </Row>

      {/* 新增/编辑权限抽屉 */}
      <Drawer
        title={editingPermission ? '编辑权限' : '新增权限'}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setEditingPermission(null);
          form.resetFields();
        }}
        width={500}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="权限编码"
            rules={[{ required: true, message: '请输入权限编码' }]}
          >
            <Input placeholder="请输入权限编码，如 user:create" disabled={!!editingPermission} />
          </Form.Item>
          <Form.Item
            name="name"
            label="权限名称"
            rules={[{ required: true, message: '请输入权限名称' }]}
          >
            <Input placeholder="请输入权限名称" />
          </Form.Item>
          <Form.Item
            name="type"
            label="权限类型"
            rules={[{ required: true, message: '请选择权限类型' }]}
          >
            <Select
              placeholder="请选择权限类型"
              options={[
                { label: '菜单权限', value: 'menu' },
                { label: '操作权限', value: 'operation' },
              ]}
            />
          </Form.Item>
          {permType === 'operation' && (
            <>
              <Form.Item name="action" label="HTTP方法">
                <Select
                  allowClear
                  placeholder="请选择HTTP方法"
                  options={[
                    { label: 'GET', value: 'GET' },
                    { label: 'POST', value: 'POST' },
                    { label: 'PUT', value: 'PUT' },
                    { label: 'DELETE', value: 'DELETE' },
                    { label: 'PATCH', value: 'PATCH' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="resource" label="API资源路径">
                <Input placeholder="如 /admin/users/:id" />
              </Form.Item>
            </>
          )}
          <Form.Item name="parentId" label="父权限">
            <Select
              allowClear
              placeholder="选择父权限"
              options={buildParentOptions(permissionTree, editingPermission?.id)}
            />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Input placeholder="请输入图标名称，如 UserOutlined" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="请输入描述" />
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editingPermission && (
            <Form.Item name="status" label="状态" initialValue="active">
              <Select
                options={[
                  { label: '启用', value: 'active' },
                  { label: '禁用', value: 'inactive' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Drawer>
    </>
  );
};

// ==================== 权限模板 Tab ====================
const TemplateManagement: React.FC = () => {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PermissionTemplateInfoDto | null>(null);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewResult, setPreviewResult] = useState<string[]>([]);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);

  // 预览模板
  const previewMutation = usePreviewTemplate({
    onSuccess: (data) => {
      setPreviewResult(data.expandedPermissions || []);
      setPreviewModalVisible(true);
    },
    onError: (error) => message.error(`预览失败: ${error.message}`),
  });

  // Mutations
  const createMutation = useCreatePermissionTemplate({
    onSuccess: () => {
      message.success('创建成功');
      setDrawerVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (error) => message.error(`创建失败: ${error.message}`),
  });

  const updateMutation = useUpdatePermissionTemplate({
    onSuccess: () => {
      message.success('更新成功');
      setDrawerVisible(false);
      setEditingTemplate(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (error) => message.error(`更新失败: ${error.message}`),
  });

  const deleteMutation = useDeletePermissionTemplate({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (error) => message.error(`删除失败: ${error.message}`),
  });

  // 打开编辑抽屉
  const handleEdit = (record: PermissionTemplateInfoDto) => {
    setEditingTemplate(record);
    form.setFieldsValue({
      ...record,
      permissionPatterns: record.permissionPatterns?.join('\n'),
    });
    setDrawerVisible(true);
  };

  // 预览
  const handlePreview = (record: PermissionTemplateInfoDto) => {
    previewMutation.mutate({ permissionPatterns: record.permissionPatterns || [] });
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const data = {
        ...values,
        permissionPatterns: values.permissionPatterns
          .split('\n')
          .map((s: string) => s.trim())
          .filter((s: string) => s),
      };
      if (editingTemplate) {
        updateMutation.mutate({ id: editingTemplate.id, data });
      } else {
        createMutation.mutate(data);
      }
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  // 表格列定义
  const columns: ProColumns<PermissionTemplateInfoDto>[] = [
    {
      title: '模板编码',
      dataIndex: 'code',
      width: 150,
    },
    {
      title: '模板名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '权限模式',
      dataIndex: 'permissionPatterns',
      width: 300,
      search: false,
      render: (_, record) => (
        <div>
          {record.permissionPatterns?.slice(0, 3).map((p, i) => (
            <Tag key={i} style={{ marginBottom: 2 }}>
              {p}
            </Tag>
          ))}
          {(record.permissionPatterns?.length || 0) > 3 && (
            <Tag>+{(record.permissionPatterns?.length || 0) - 3} 更多</Tag>
          )}
        </div>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
      search: false,
    },
    {
      title: '系统模板',
      dataIndex: 'isSystem',
      width: 100,
      search: false,
      render: (_, record) => (
        <Tag color={record.isSystem ? 'blue' : 'default'}>{record.isSystem ? '是' : '否'}</Tag>
      ),
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
      width: 220,
      search: false,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => handlePreview(record)}
            loading={previewMutation.isPending}
          >
            预览
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除该模板吗？"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.isSystem}
              loading={deleteMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<PermissionTemplateInfoDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="权限模板列表"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await permissionTemplateApi.getTemplates({
              page: params.current,
              pageSize: params.pageSize,
              code: params.code,
              name: params.name,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch (error) {
            console.error('获取数据失败:', error);
            return { data: [], total: 0, success: false };
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
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingTemplate(null);
              form.resetFields();
              setDrawerVisible(true);
            }}
          >
            新增模板
          </Button>,
        ]}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />

      {/* 新增/编辑模板抽屉 */}
      <Drawer
        title={editingTemplate ? '编辑模板' : '新增模板'}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setEditingTemplate(null);
          form.resetFields();
        }}
        width={500}
        footer={
          <Space>
            <Button onClick={() => setDrawerVisible(false)}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="模板编码"
            rules={[{ required: true, message: '请输入模板编码' }]}
          >
            <Input placeholder="请输入模板编码，如 READONLY" disabled={!!editingTemplate} />
          </Form.Item>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="请输入模板名称" />
          </Form.Item>
          <Form.Item
            name="permissionPatterns"
            label="权限模式"
            rules={[{ required: true, message: '请输入权限模式' }]}
            extra={
              <div>
                <div>每行一个权限模式，支持通配符：</div>
                <div>• *:list - 所有模块的列表权限</div>
                <div>• user:* - 用户模块的所有权限</div>
                <div>• user:create - 具体的权限编码</div>
              </div>
            }
          >
            <Input.TextArea rows={6} placeholder={`*:list\n*:detail\nuser:create\nuser:update`} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="请输入描述" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 预览弹窗 */}
      <Modal
        title="模板权限预览"
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width={600}
      >
        <Alert
          type="info"
          message={`共匹配 ${previewResult.length} 个权限`}
          style={{ marginBottom: 16 }}
        />
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {previewResult.length > 0 ? (
            previewResult.map((code, index) => (
              <Tag key={index} style={{ marginBottom: 4 }}>
                {code}
              </Tag>
            ))
          ) : (
            <div style={{ textAlign: 'center', color: '#999' }}>暂无匹配的权限</div>
          )}
        </div>
      </Modal>
    </>
  );
};

// ==================== 主页面 ====================
const PermissionPage: React.FC = () => {
  const tabItems = [
    {
      key: 'role',
      label: (
        <span>
          <TeamOutlined /> 角色管理
        </span>
      ),
      children: <RoleManagement />,
    },
    {
      key: 'permission',
      label: (
        <span>
          <KeyOutlined /> 权限管理
        </span>
      ),
      children: <PermissionManagement />,
    },
    {
      key: 'template',
      label: (
        <span>
          <FileTextOutlined /> 权限模板
        </span>
      ),
      children: <TemplateManagement />,
    },
  ];

  return (
    <Card>
      <Tabs items={tabItems} defaultActiveKey="role" />
    </Card>
  );
};

export default PermissionPage;
