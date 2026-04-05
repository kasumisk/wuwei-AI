import React, { useState, useRef } from 'react';
import { Card, Button, Space, Tag, Popconfirm, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import ConfigurableProForm from '@/components/ProForm';
import type { FormConfig } from '@/types/form';
import {
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useTestProvider,
  providerApi,
  type ProviderInfoDto,
} from '../../../services/providerService';

const ProviderManagement: React.FC = () => {
  const [currentRecord, setCurrentRecord] = useState<ProviderInfoDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const actionRef = useRef<ActionType>(null);

  // API hooks
  const createMutation = useCreateProvider({
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

  const updateMutation = useUpdateProvider({
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

  const deleteMutation = useDeleteProvider({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`删除失败: ${error.message}`);
    },
  });

  const testMutation = useTestProvider({
    onSuccess: (result: any) => {
      if (result.success) {
        message.success(`连接测试成功，延迟: ${result.latency}ms`);
      } else {
        message.error(`连接测试失败: ${result.error || result.message}`);
      }
    },
    onError: (error: any) => {
      message.error(`测试失败: ${error.message}`);
    },
  });

  // 事件处理函数
  const handleCreate = () => {
    setIsEditMode(false);
    setCurrentRecord(null);
    setModalVisible(true);
  };

  const handleEdit = (record: ProviderInfoDto) => {
    setIsEditMode(true);
    setCurrentRecord(record);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    (deleteMutation.mutate as any)(id);
  };

  const handleTest = (id: string) => {
    testMutation.mutate({ providerId: id } as any);
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    const formData = {
      ...values,
      metadata: values.metadata ? JSON.parse(values.metadata) : undefined,
    };

    if (isEditMode && currentRecord) {
      updateMutation.mutate({
        id: currentRecord.id,
        data: formData,
      });
    } else {
      createMutation.mutate(formData as any);
    }
  };

  // 表格列定义
  const columns: ProColumns<ProviderInfoDto>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      search: false,
      render: (_: any, record: ProviderInfoDto) => <Tag>{record.type}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      search: false,
      render: (_: any, record: ProviderInfoDto) => {
        const statusConfig = {
          active: { color: 'success', icon: <CheckCircleOutlined />, text: '正常' },
          inactive: { color: 'default', icon: <CloseCircleOutlined />, text: '未激活' },
          error: { color: 'error', icon: <ExclamationCircleOutlined />, text: '错误' },
        };
        const config = statusConfig[record.status];
        return (
          <Tag color={config.color} icon={config.icon}>
            {config.text}
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
      render: (_: any, record: ProviderInfoDto) => (
        <Tag color={record.enabled ? 'success' : 'default'}>{record.enabled ? '是' : '否'}</Tag>
      ),
    },
    {
      title: 'API 地址',
      dataIndex: 'baseUrl',
      ellipsis: true,
      search: false,
    },
    {
      title: '超时(ms)',
      dataIndex: 'timeout',
      width: 100,
      search: false,
    },
    {
      title: '重试次数',
      dataIndex: 'retryCount',
      width: 100,
      search: false,
    },
    {
      title: '最后检查',
      dataIndex: 'lastHealthCheck',
      width: 180,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right',
      search: false,
      render: (_: any, record: ProviderInfoDto) => (
        <Space>
          <Button
            size="small"
            icon={<ApiOutlined />}
            onClick={() => handleTest(record.id)}
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
            title="确定要删除这个提供商吗？"
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

  // 表单配置
  const formConfig: FormConfig = {
    title: isEditMode ? '编辑提供商' : '新增提供商',
    layout: 'vertical',
    fields: [
      {
        name: 'name',
        label: '提供商名称',
        type: 'text',
        required: true,
        fieldProps: {
          placeholder: '例如: OpenAI',
        },
      },
      {
        name: 'type',
        label: '提供商类型',
        type: 'select',
        required: true,
        options: [
          { label: 'OpenAI', value: 'openai' },
          { label: 'Anthropic', value: 'anthropic' },
          { label: '百度', value: 'baidu' },
          { label: '阿里云', value: 'alibaba' },
          { label: '腾讯云', value: 'tencent' },
          { label: '自定义', value: 'custom' },
        ],
        fieldProps: {
          placeholder: '选择提供商类型',
          disabled: isEditMode,
        },
      },
      {
        name: 'baseUrl',
        label: 'API 基础 URL',
        type: 'text',
        required: true,
        fieldProps: {
          placeholder: 'https://api.openai.com/v1',
        },
      },
      {
        name: 'apiKey',
        label: 'API 密钥',
        type: 'password',
        required: true,
        fieldProps: {
          placeholder: 'sk-xxxxx',
        },
      },
      {
        name: 'healthCheckUrl',
        label: '健康检查 URL',
        type: 'text',
        fieldProps: {
          placeholder: 'https://api.openai.com/v1/models',
        },
      },
      {
        name: 'timeout',
        label: '请求超时(毫秒)',
        type: 'number',
        fieldProps: {
          min: 1000,
          max: 120000,
        },
      },
      {
        name: 'retryCount',
        label: '重试次数',
        type: 'number',
        fieldProps: {
          min: 0,
          max: 10,
        },
      },
      {
        name: 'enabled',
        label: '启用',
        type: 'switch',
        fieldProps: {
          checkedChildren: '是',
          unCheckedChildren: '否',
        },
      },
      {
        name: 'metadata',
        label: '元数据 (JSON)',
        type: 'textarea',
        fieldProps: {
          rows: 3,
          placeholder: '{"key": "value"}',
        },
      },
    ],
  };

  return (
    <Card>
      <ProTable<ProviderInfoDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="提供商列表"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await providerApi.getProviders({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.name,
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
            新增提供商
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
            : { enabled: true, timeout: 30000, retryCount: 3 }) as Record<string, any>
        }
        onFinish={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
        width={600}
      />
    </Card>
  );
};

export default ProviderManagement;

export const routeConfig = {
  name: 'provider',
  title: '提供商管理',
  icon: 'ApiOutlined',
  order: 40,
  requireAuth: true,
  requireAdmin: true,
};
