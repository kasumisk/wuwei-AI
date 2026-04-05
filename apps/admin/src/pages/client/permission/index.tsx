import React, { useState, useRef, useEffect } from 'react';
import { Card, Button, Space, Tag, Popconfirm, message, Alert, Select } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SafetyOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  usePermissions,
  useCreatePermission,
  useUpdatePermission,
  useDeletePermission,
  type PermissionInfoDto,
} from '@/services/permissionService';
import clientApi from '@/services/clientService';
import { useProviders } from '@/services/providerService';
import { useModels } from '@/services/modelService';
import ConfigurableProForm from '@/components/ProForm';
import type { FormConfig } from '@/types/form';

// 路由配置
export const routeConfig = {
  name: 'PermissionManagement',
  title: '权限配置',
  icon: <SafetyOutlined />,
  order: 4,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};

const CapabilityTypes = {
  'text.generation': '文本生成',
  'text.completion': '文本补全',
  'text.embedding': '文本向量化',
  'image.generation': '图像生成',
  'image.edit': '图像编辑',
  'speech.to_text': '语音转文字',
  'text.to_speech': '文字转语音',
  translation: '翻译',
  moderation: '内容审核',
};

type ModelSelectionStrategy = 'any' | 'provider' | 'specific';

interface Client {
  id: string;
  name: string;
}

const PermissionManagement: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>();
  const [currentRecord, setCurrentRecord] = useState<PermissionInfoDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [modelStrategy, setModelStrategy] = useState<ModelSelectionStrategy>('any');
  const actionRef = useRef<ActionType>(null);

  // React Query Hooks - 添加 enabled 选项避免不必要的请求
  const { data: permissionsData, isLoading: permissionsLoading } = usePermissions(
    selectedClientId!,
    { enabled: !!selectedClientId }
  );
  const { data: providersData } = useProviders({ page: 1, pageSize: 100 });
  const { data: modelsData } = useModels({ page: 1, pageSize: 100 });

  const permissions = (permissionsData as any) || [];
  const providers = (providersData as any)?.list || [];
  const models = (modelsData as any)?.list || [];

  console.log('permissions', permissions, permissionsData);
  console.log('providers', providers);
  console.log('models', models);

  const createMutation = useCreatePermission({
    onSuccess: () => {
      message.success('权限添加成功');
      handleModalClose();
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`添加失败: ${error.message}`),
  });

  const updateMutation = useUpdatePermission({
    onSuccess: () => {
      message.success('权限更新成功');
      handleModalClose();
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`更新失败: ${error.message}`),
  });

  const deleteMutation = useDeletePermission({
    onSuccess: () => {
      message.success('权限删除成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`删除失败: ${error.message}`),
  });

  // 获取客户端列表
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const response = await clientApi.getClients({ page: 1, pageSize: 100 });
        setClients(response.list);
      } catch (error: any) {
        message.error(error.message || '获取客户端列表失败');
      }
    };
    fetchClients();
  }, []);

  // 表格列定义
  const columns: ProColumns<PermissionInfoDto>[] = [
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      width: 160,
      render: (_: any, record: PermissionInfoDto) => (
        <Tag color="blue">
          {CapabilityTypes[record.capabilityType as keyof typeof CapabilityTypes] ||
            record.capabilityType}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (_: any, record: PermissionInfoDto) => (
        <Tag
          color={record.enabled ? 'success' : 'default'}
          icon={record.enabled ? <CheckOutlined /> : null}
        >
          {record.enabled ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '模型限制',
      width: 180,
      render: (_: any, record: PermissionInfoDto) => {
        if (record.allowedModels && record.allowedModels.length > 0) {
          return <Tag color="green">{record.allowedModels.length} 个指定模型</Tag>;
        }
        if (record.allowedProviders && record.allowedProviders.length > 0) {
          return <Tag color="cyan">{record.allowedProviders.length} 个提供商</Tag>;
        }
        return <Tag>任意可用模型</Tag>;
      },
    },
    {
      title: '速率',
      dataIndex: 'rateLimit',
      width: 100,
      render: (_: any, record: PermissionInfoDto) => `${record.rateLimit}/分钟`,
    },
    {
      title: '配额',
      dataIndex: 'quotaLimit',
      width: 100,
      render: (_: any, record: PermissionInfoDto) =>
        record.quotaLimit ? record.quotaLimit.toLocaleString() : '不限',
    },
    {
      title: '首选',
      dataIndex: 'preferredProvider',
      width: 100,
      render: (_: any, record: PermissionInfoDto) => record.preferredProvider || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (_: any, record: PermissionInfoDto) =>
        new Date(record.createdAt).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 140,
      render: (_: any, record: PermissionInfoDto) => (
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
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 表单配置
  const getFormConfig = (): FormConfig => {
    const baseFields = [
      {
        name: 'capabilityType',
        label: '能力类型',
        type: 'select' as const,
        required: true,
        disabled: isEditMode,
        fieldProps: {
          placeholder: '请选择能力类型',
          options: Object.entries(CapabilityTypes).map(([k, v]) => ({
            label: v,
            value: k,
          })),
        },
      },
      {
        name: 'enabled',
        label: '启用状态',
        type: 'switch' as const,
        fieldProps: {
          checkedChildren: '启用',
          unCheckedChildren: '禁用',
        },
        initialValue: true,
      },
      {
        name: 'rateLimit',
        label: '速率限制（次/分钟）',
        type: 'number' as const,
        required: true,
        fieldProps: {
          min: 1,
          max: 10000,
        },
        initialValue: 100,
      },
    ];

    const modelFields = [
      {
        name: 'modelStrategy',
        label: '选择策略',
        type: 'radio' as const,
        fieldProps: {
          options: [
            { label: '任意可用模型', value: 'any' },
            { label: '指定提供商', value: 'provider' },
            { label: '指定具体模型', value: 'specific' },
          ],
        },
        initialValue: 'any',
      },
      ...(modelStrategy === 'provider'
        ? [
            {
              name: 'allowedProviders',
              label: '允许的提供商',
              type: 'select' as const,
              required: true,
              fieldProps: {
                mode: 'multiple',
                placeholder: '选择提供商',
                options: providers.map((p: any) => ({ label: p.name, value: p.name })),
              },
            },
            {
              name: 'preferredProvider',
              label: '首选提供商',
              type: 'select' as const,
              fieldProps: {
                placeholder: '可选',
                allowClear: true,
                options: providers.map((p: any) => ({ label: p.name, value: p.name })),
              },
            },
          ]
        : []),
      ...(modelStrategy === 'specific'
        ? [
            {
              name: 'allowedModels',
              label: '允许的模型',
              type: 'select' as const,
              required: true,
              fieldProps: {
                mode: 'multiple',
                placeholder: '选择模型',
                showSearch: true,
                options: models.map((m: any) => ({
                  label: `${m.displayName} (${m.providerName})`,
                  value: m.modelName,
                })),
                filterOption: (input: string, option: any) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()),
              },
            },
          ]
        : []),
    ];

    const quotaFields = [
      {
        name: 'quotaLimit',
        label: '配额限制',
        type: 'number' as const,
        tooltip: '文本: token数 | 图像: 图片数',
        fieldProps: {
          min: 0,
          placeholder: '不限制',
        },
      },
      {
        name: 'costLimit',
        label: '单次请求最大成本($)',
        type: 'number' as const,
        fieldProps: {
          min: 0,
          step: 0.01,
          placeholder: '不限制',
        },
      },
      {
        name: 'maxConcurrentRequests',
        label: '最大并发请求数',
        type: 'number' as const,
        fieldProps: {
          min: 1,
          max: 100,
          placeholder: '不限制',
        },
      },
    ];

    const advancedFields = [
      {
        name: 'fallbackEnabled',
        label: '允许故障转移',
        type: 'switch' as const,
        tooltip: '故障转移可提高可用性，但可能使用不同提供商的模型',
        fieldProps: {
          checkedChildren: '是',
          unCheckedChildren: '否',
        },
        initialValue: true,
      },
    ];

    return {
      title: isEditMode ? '编辑权限' : '添加权限',
      layout: 'vertical',
      tabs: [
        { key: 'basic', label: '基础配置', fields: baseFields },
        { key: 'model', label: '模型选择', fields: modelFields },
        { key: 'quota', label: '配额限制', fields: quotaFields },
        { key: 'advanced', label: '高级选项', fields: advancedFields },
      ],
    };
  };

  const handleModalClose = () => {
    setModalVisible(false);
    setCurrentRecord(null);
    setModelStrategy('any');
  };

  const handleCreate = () => {
    if (!selectedClientId) {
      message.warning('请先选择客户端');
      return;
    }
    setIsEditMode(false);
    setCurrentRecord(null);
    setModelStrategy('any');
    setModalVisible(true);
  };

  const handleEdit = (record: PermissionInfoDto) => {
    setIsEditMode(true);
    setCurrentRecord(record);

    let strategy: ModelSelectionStrategy = 'any';
    if (record.allowedModels && record.allowedModels.length > 0) {
      strategy = 'specific';
    } else if (record.allowedProviders && record.allowedProviders.length > 0) {
      strategy = 'provider';
    }
    setModelStrategy(strategy);
    setModalVisible(true);
  };

  const handleDelete = (permissionId: string) => {
    if (!selectedClientId) return;
    deleteMutation.mutate({ clientId: selectedClientId, permissionId });
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    let allowedProviders: string[] | undefined;
    let allowedModels: string[] | undefined;
    let preferredProvider: string | undefined;

    if (values.modelStrategy === 'provider') {
      allowedProviders = values.allowedProviders;
      preferredProvider = values.preferredProvider;
    } else if (values.modelStrategy === 'specific') {
      allowedModels = values.allowedModels;
    }

    const payload = {
      clientId: selectedClientId!,
      capabilityType: values.capabilityType,
      enabled: values.enabled,
      rateLimit: values.rateLimit,
      quotaLimit: values.quotaLimit,
      preferredProvider,
      allowedProviders,
      allowedModels,
      config: {
        maxConcurrentRequests: values.maxConcurrentRequests,
        fallbackEnabled: values.fallbackEnabled,
        costLimit: values.costLimit,
      },
    };

    if (isEditMode && currentRecord) {
      updateMutation.mutate({
        clientId: selectedClientId!,
        permissionId: currentRecord.id,
        data: payload,
      });
    } else {
      createMutation.mutate({ clientId: selectedClientId!, data: payload });
    }
  };

  return (
    <div className="p-6">
      <Card>
        <Alert
          message="权限配置说明"
          description="为客户端配置可访问的AI能力及其模型使用权限。支持细粒度的提供商和模型级别控制。"
          type="info"
          showIcon
          className="mb-4"
        />

        <div className="mb-4">
          <Space>
            <span>选择客户端:</span>
            <Select
              showSearch
              placeholder="请选择客户端"
              style={{ width: 300 }}
              value={selectedClientId}
              onChange={setSelectedClientId}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={clients.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Space>
        </div>

        {selectedClientId ? (
          <ProTable<PermissionInfoDto>
            actionRef={actionRef}
            rowKey="id"
            headerTitle="权限列表"
            columns={columns}
            dataSource={permissions || []}
            loading={permissionsLoading || createMutation.isPending || updateMutation.isPending}
            search={false}
            options={{ reload: true }}
            toolBarRender={() => [
              <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                添加权限
              </Button>,
            ]}
            pagination={{
              pageSize: 10,
              showTotal: (total) => `共 ${total} 条`,
            }}
            scroll={{ x: 1100 }}
          />
        ) : (
          <div className="text-center py-20 text-gray-400">请先选择一个客户端</div>
        )}

        <ConfigurableProForm
          mode="modal"
          config={getFormConfig()}
          visible={modalVisible}
          onVisibleChange={(visible) => {
            setModalVisible(visible);
            if (!visible) {
              setCurrentRecord(null);
              setModelStrategy('any');
            }
          }}
          onValuesChange={(changedValues) => {
            // 监听 modelStrategy 的变化,更新状态以触发表单重新渲染
            if (changedValues.modelStrategy) {
              setModelStrategy(changedValues.modelStrategy as ModelSelectionStrategy);
            }
          }}
          initialValues={
            currentRecord
              ? {
                  capabilityType: currentRecord.capabilityType,
                  enabled: currentRecord.enabled,
                  rateLimit: currentRecord.rateLimit,
                  quotaLimit: currentRecord.quotaLimit,
                  modelStrategy:
                    currentRecord.allowedModels && currentRecord.allowedModels.length > 0
                      ? 'specific'
                      : currentRecord.allowedProviders && currentRecord.allowedProviders.length > 0
                        ? 'provider'
                        : 'any',
                  allowedProviders: currentRecord.allowedProviders,
                  preferredProvider: currentRecord.preferredProvider,
                  allowedModels: currentRecord.allowedModels,
                  maxConcurrentRequests: currentRecord.config?.maxConcurrentRequests,
                  fallbackEnabled: currentRecord.config?.fallbackEnabled ?? true,
                  costLimit: currentRecord.config?.costLimit,
                }
              : {
                  enabled: true,
                  rateLimit: 100,
                  modelStrategy: 'any',
                  fallbackEnabled: true,
                }
          }
          onFinish={handleFormSubmit}
          loading={isEditMode ? updateMutation.isPending : createMutation.isPending}
        />
      </Card>
    </div>
  );
};

export default PermissionManagement;
