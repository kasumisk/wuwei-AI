import React, { useState, useRef } from 'react';
import { Card, Button, Space, Tag, Popconfirm, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import ConfigurableProForm from '@/components/ProForm';
import type { FormConfig } from '@/types/form';
import {
  useCreateModel,
  useUpdateModel,
  useDeleteModel,
  useTestModel,
  modelApi,
  type ModelInfoDto,
} from '../../../services/modelService';
import { ModelStatus } from '@ai-platform/shared';
import { useProviders } from '../../../services/providerService';

const ModelManagement: React.FC = () => {
  const [currentRecord, setCurrentRecord] = useState<ModelInfoDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const actionRef = useRef<ActionType>(null);

  // 获取提供商列表用于表单选项
  const { data: providersData } = useProviders({ page: 1, pageSize: 100 });

  // API hooks
  const createMutation = useCreateModel({
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

  const updateMutation = useUpdateModel({
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

  const deleteMutation = useDeleteModel({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`删除失败: ${error.message}`);
    },
  });

  const testMutation = useTestModel({
    onSuccess: (result: any) => {
      if (result.success) {
        message.success(`模型测试成功，延迟: ${result.latency}ms`);
      } else {
        message.error(`模型测试失败: ${result.error || result.message}`);
      }
    },
    onError: (error: any) => {
      message.error(`测试失败: ${error.message}`);
    },
  });

  // 表格列定义
  const columns: ProColumns<ModelInfoDto>[] = [
    {
      title: '显示名称',
      dataIndex: 'displayName',
      width: 150,
    },
    {
      title: '模型名称',
      dataIndex: 'modelName',
      width: 150,
    },
    {
      title: '模型名',
      dataIndex: 'modelName',
      width: 120,
      search: false,
      render: (_: any, record: ModelInfoDto) => <Tag color="blue">{record.modelName}</Tag>,
    },
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      width: 120,
      valueType: 'select',
      valueEnum: {
        '': { text: '全部' },
        chat: { text: 'Chat' },
        completion: { text: 'Completion' },
        embedding: { text: 'Embedding' },
        'image-generation': { text: 'Image Generation' },
        'speech-to-text': { text: 'Speech to Text' },
        'text-to-speech': { text: 'Text to Speech' },
        moderation: { text: 'Moderation' },
      },
      render: (_: any, record: ModelInfoDto) => <Tag>{record.capabilityType}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        '': { text: '全部' },
        active: { text: '可用' },
        inactive: { text: '不可用' },
      },
      render: (_: any, record: ModelInfoDto) => {
        const isActive = record.status === ModelStatus.ACTIVE;
        return (
          <Tag
            color={isActive ? 'success' : 'default'}
            icon={isActive ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          >
            {isActive ? '可用' : '不可用'}
          </Tag>
        );
      },
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      valueType: 'select',
      valueEnum: {
        '': { text: '全部' },
        true: { text: '是' },
        false: { text: '否' },
      },
      render: (_: any, record: ModelInfoDto) => (
        <Tag color={record.enabled ? 'success' : 'default'}>{record.enabled ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      search: false,
    },
    {
      title: '价格 (输入/输出)',
      key: 'pricing',
      width: 180,
      search: false,
      render: (_: any, record: ModelInfoDto) =>
        record.pricing ? (
          <span>
            {record.pricing.inputCostPer1kTokens} / {record.pricing.outputCostPer1kTokens}{' '}
            {record.pricing.currency}
          </span>
        ) : (
          '-'
        ),
    },
    {
      title: '最大 Tokens',
      dataIndex: ['limits', 'maxTokens'],
      width: 120,
      search: false,
      render: (_: any, record: ModelInfoDto) => record.limits?.maxTokens?.toLocaleString() || '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      search: false,
      render: (_: any, record: ModelInfoDto) => (
        <Space>
          <Button
            size="small"
            icon={<ApiOutlined />}
            onClick={() => testMutation.mutate({ modelId: record.id } as any)}
            loading={testMutation.isPending}
          >
            测试
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定要删除这个模型吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 表单配置 - 使用 tabs 组织
  const formConfig: FormConfig = {
    title: isEditMode ? '编辑模型' : '新增模型',
    layout: 'vertical',
    tabs: [
      {
        key: 'basic',
        label: '基本信息',
        fields: [
          {
            name: 'providerId',
            label: '提供商',
            type: 'select',
            required: true,
            colProps: { span: 12 },
            options:
              (providersData as any)?.list?.map((provider: any) => ({
                label: provider.name,
                value: provider.id,
              })) || [],
            fieldProps: {
              placeholder: '选择提供商',
              disabled: isEditMode,
              showSearch: true,
            },
          },
          {
            name: 'capabilityType',
            label: '能力类型',
            type: 'select',
            required: true,
            colProps: { span: 12 },
            options: [
              { label: 'Chat', value: 'chat' },
              { label: 'Completion', value: 'completion' },
              { label: 'Embedding', value: 'embedding' },
              { label: 'Image Generation', value: 'image-generation' },
              { label: 'Speech to Text', value: 'speech-to-text' },
              { label: 'Text to Speech', value: 'text-to-speech' },
              { label: 'Moderation', value: 'moderation' },
            ],
            fieldProps: {
              placeholder: '选择能力类型',
              disabled: isEditMode,
            },
          },
          {
            name: 'modelName',
            label: '模型名称',
            type: 'text',
            required: true,
            colProps: { span: 12 },
            fieldProps: {
              placeholder: '例如: gpt-4',
              disabled: isEditMode,
            },
          },
          {
            name: 'displayName',
            label: '显示名称',
            type: 'text',
            required: true,
            colProps: { span: 12 },
            fieldProps: {
              placeholder: '例如: GPT-4',
            },
          },
          {
            name: 'enabled',
            label: '启用',
            type: 'switch',
            colProps: { span: 12 },
            fieldProps: {
              checkedChildren: '是',
              unCheckedChildren: '否',
            },
          },
          {
            name: 'priority',
            label: '优先级',
            type: 'number',
            colProps: { span: 12 },
            fieldProps: {
              min: 1,
              max: 100,
            },
          },
        ],
      },
      {
        key: 'pricing',
        label: '定价配置',
        fields: [
          {
            name: 'inputCostPer1kTokens',
            label: '输入价格 (每千tokens)',
            type: 'number',
            required: true,
            colProps: { span: 8 },
            fieldProps: {
              min: 0,
              step: 0.0001,
              precision: 4,
            },
          },
          {
            name: 'outputCostPer1kTokens',
            label: '输出价格 (每千tokens)',
            type: 'number',
            required: true,
            colProps: { span: 8 },
            fieldProps: {
              min: 0,
              step: 0.0001,
              precision: 4,
            },
          },
          {
            name: 'currency',
            label: '货币',
            type: 'select',
            required: true,
            colProps: { span: 8 },
            options: [
              { label: 'USD', value: 'USD' },
              { label: 'CNY', value: 'CNY' },
              { label: 'EUR', value: 'EUR' },
            ],
          },
        ],
      },
      {
        key: 'limits',
        label: '限制配置',
        fields: [
          {
            name: 'maxTokens',
            label: '最大 Tokens',
            type: 'number',
            colProps: { span: 8 },
            fieldProps: {
              min: 1,
            },
          },
          {
            name: 'contextWindow',
            label: '上下文窗口',
            type: 'number',
            colProps: { span: 8 },
            fieldProps: {
              min: 1,
            },
          },
          {
            name: 'maxRequestsPerMinute',
            label: '分钟限流',
            type: 'number',
            colProps: { span: 8 },
            fieldProps: {
              min: 1,
            },
          },
        ],
      },
      {
        key: 'features',
        label: '功能特性',
        fields: [
          {
            name: 'streaming',
            label: '流式',
            type: 'switch',
            colProps: { span: 8 },
          },
          {
            name: 'functionCalling',
            label: '函数调用',
            type: 'switch',
            colProps: { span: 8 },
          },
          {
            name: 'vision',
            label: '视觉',
            type: 'switch',
            colProps: { span: 8 },
          },
        ],
      },
      {
        key: 'config',
        label: '配置覆盖',
        fields: [
          {
            name: 'endpoint',
            label: '自定义端点',
            type: 'text',
            colProps: { span: 24 },
            fieldProps: {
              placeholder: '留空使用 Provider 的 baseUrl',
            },
            tooltip: '覆盖提供商的默认端点，用于某些特殊模型',
          },
          {
            name: 'customApiKey',
            label: '自定义 API Key',
            type: 'password',
            colProps: { span: 24 },
            fieldProps: {
              placeholder: '留空使用 Provider 的 apiKey',
            },
            tooltip: '覆盖提供商的 API Key，用于某些需要单独认证的模型',
          },
          {
            name: 'customTimeout',
            label: '自定义超时（毫秒）',
            type: 'number',
            colProps: { span: 12 },
            fieldProps: {
              min: 1000,
              placeholder: '留空使用 Provider 的 timeout',
            },
          },
          {
            name: 'customRetries',
            label: '自定义重试次数',
            type: 'number',
            colProps: { span: 12 },
            fieldProps: {
              min: 0,
              max: 10,
              placeholder: '留空使用 Provider 的 retryCount',
            },
          },
        ],
      },
    ],
  };

  // 事件处理函数
  const handleCreate = () => {
    setIsEditMode(false);
    setCurrentRecord(null);
    setModalVisible(true);
  };

  const handleEdit = (record: ModelInfoDto) => {
    setIsEditMode(true);
    // 展开嵌套数据到表单字段
    const formData = {
      ...record,
      inputCostPer1kTokens: record.pricing?.inputCostPer1kTokens,
      outputCostPer1kTokens: record.pricing?.outputCostPer1kTokens,
      currency: record.pricing?.currency || 'USD',
      maxTokens: record.limits?.maxTokens,
      contextWindow: record.limits?.contextWindow,
      maxRequestsPerMinute: record.limits?.maxRequestsPerMinute,
      streaming: record.features?.streaming ?? false,
      functionCalling: record.features?.functionCalling ?? false,
      vision: record.features?.vision ?? false,
      endpoint: record.configOverride?.endpoint,
      customApiKey: record.configOverride?.customApiKey,
      customTimeout: record.configOverride?.customTimeout,
      customRetries: record.configOverride?.customRetries,
    };
    setCurrentRecord(formData as any);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    (deleteMutation.mutate as any)(id);
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    // 重新构建嵌套对象
    const pricing = {
      inputCostPer1kTokens: values.inputCostPer1kTokens,
      outputCostPer1kTokens: values.outputCostPer1kTokens,
      currency: values.currency,
    };

    const limits = {
      maxTokens: values.maxTokens,
      contextWindow: values.contextWindow,
      maxRequestsPerMinute: values.maxRequestsPerMinute,
    };

    const features = {
      streaming: values.streaming,
      functionCalling: values.functionCalling,
      vision: values.vision,
    };

    // 配置覆盖（只包含有值的字段）
    const configOverride =
      values.endpoint || values.customApiKey || values.customTimeout || values.customRetries
        ? {
            endpoint: values.endpoint,
            customApiKey: values.customApiKey,
            customTimeout: values.customTimeout,
            customRetries: values.customRetries,
          }
        : undefined;

    const formData = {
      providerId: values.providerId,
      modelName: values.modelName,
      displayName: values.displayName,
      capabilityType: values.capabilityType,
      enabled: values.enabled,
      priority: values.priority,
      pricing,
      limits,
      features,
      configOverride,
    };

    if (isEditMode && currentRecord) {
      updateMutation.mutate({
        id: (currentRecord as any).id,
        data: formData,
      });
    } else {
      createMutation.mutate(formData as any);
    }
  };

  return (
    <Card>
      <ProTable<ModelInfoDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="模型列表"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await modelApi.getModels({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.displayName || params.modelName,
              capabilityType: params.capabilityType,
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
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增模型
          </Button>,
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
        initialValues={
          (currentRecord
            ? { ...currentRecord }
            : {
                enabled: true,
                priority: 1,
                currency: 'USD',
                streaming: false,
                functionCalling: false,
                vision: false,
              }) as Record<string, any>
        }
        onFinish={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
        width={800}
      />
    </Card>
  );
};

export default ModelManagement;

export const routeConfig = {
  name: 'model',
  title: '模型配置',
  icon: 'DatabaseOutlined',
  order: 41,
  requireAuth: true,
  requireAdmin: true,
};
