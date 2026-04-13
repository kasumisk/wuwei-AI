import React, { useState, useRef, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Button,
  Space,
  Typography,
  Tabs,
  Popconfirm,
  message,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Badge,
  Alert,
} from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  HeartOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  providerApi,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useTestProvider,
  useCheckAllHealth,
  type ProviderInfoDto,
} from '@/services/providerService';
import {
  modelApi,
  useCreateModel,
  useUpdateModel,
  useDeleteModel,
  useTestModel,
  type ModelInfoDto,
} from '@/services/modelService';

const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'ai-service',
  title: 'AI 服务管理',
  icon: 'RobotOutlined',
  order: 50,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const PROVIDER_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  openai: { label: 'OpenAI', color: 'green' },
  azure_openai: { label: 'Azure OpenAI', color: 'blue' },
  anthropic: { label: 'Anthropic', color: 'purple' },
  google: { label: 'Google', color: 'cyan' },
  custom: { label: '自定义', color: 'default' },
};

// ==================== Provider Tab ====================

const ProviderTab: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<ProviderInfoDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);
  const [allData, setAllData] = useState<ProviderInfoDto[]>([]);

  const createMutation = useCreateProvider({
    onSuccess: () => {
      message.success('创建成功');
      setFormVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateProvider({
    onSuccess: () => {
      message.success('更新成功');
      setFormVisible(false);
      setEditing(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteProvider({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const testMutation = useTestProvider({
    onSuccess: (result: any) => {
      if (result.success) {
        message.success(`连接成功 (${result.latency}ms)`);
      } else {
        message.warning(`连接失败: ${result.error || result.message}`);
      }
    },
    onError: (e: any) => message.error(`测试失败: ${e.message}`),
  });
  const checkAllMutation = useCheckAllHealth({
    onSuccess: () => {
      message.success('批量健康检查完成');
      actionRef.current?.reload();
    },
  });

  const handleEdit = (record: ProviderInfoDto) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      type: record.type,
      baseUrl: record.baseUrl,
      enabled: record.enabled,
      healthCheckUrl: record.healthCheckUrl,
      timeout: record.timeout,
      retryCount: record.retryCount,
    });
    setFormVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  // 概览
  const overview = useMemo(() => {
    if (!allData.length) return null;
    const total = allData.length;
    const enabled = allData.filter((p) => p.enabled).length;
    const disabled = total - enabled;
    const typeDist = allData.reduce(
      (acc, p) => {
        const t = p.type || 'custom';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return { total, enabled, disabled, typeDist };
  }, [allData]);

  const columns: ProColumns<ProviderInfoDto>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
      render: (_, record) => (
        <Space>
          <Badge status={record.enabled ? 'success' : 'default'} />
          <Text strong>{record.name}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (v) => {
        const cfg = PROVIDER_TYPE_CONFIG[v as string];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{v as string}</Tag>;
      },
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      width: 250,
      ellipsis: true,
      search: false,
      render: (url) => (
        <Text copyable style={{ fontSize: 12 }}>
          {url as string}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      search: false,
      render: (enabled) =>
        enabled ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            启用
          </Tag>
        ) : (
          <Tag color="default" icon={<CloseCircleOutlined />}>
            禁用
          </Tag>
        ),
    },
    {
      title: '超时(ms)',
      dataIndex: 'timeout',
      width: 80,
      search: false,
      render: (v) => (v ? `${v}ms` : '-'),
    },
    {
      title: '重试',
      dataIndex: 'retryCount',
      width: 60,
      search: false,
      render: (v) => (v != null ? `${v}次` : '-'),
    },
    {
      title: '操作',
      width: 220,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => testMutation.mutate({ providerId: record.id } as any)}
            loading={testMutation.isPending}
          >
            测试
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
            title="确认删除？删除后关联的模型将不可用"
            onConfirm={() => deleteMutation.mutate(record.id as any)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {overview && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="提供商总数"
                value={overview.total}
                prefix={<CloudServerOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已启用"
                value={overview.enabled}
                valueStyle={{ color: '#52c41a' }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="已禁用" value={overview.disabled} valueStyle={{ color: '#999' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Space wrap>
                {Object.entries(overview.typeDist).map(([type, count]) => {
                  const cfg = PROVIDER_TYPE_CONFIG[type];
                  return (
                    <Tag key={type} color={cfg?.color || 'default'}>
                      {cfg?.label || type}: {count}
                    </Tag>
                  );
                })}
              </Space>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                类型分布
              </Text>
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<ProviderInfoDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const res = await providerApi.getProviders({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.name,
            type: params.type,
          });
          setAllData((res as any).list || []);
          return {
            data: (res as any).list || [],
            total: (res as any).total || 0,
            success: true,
          };
        }}
        rowKey="id"
        scroll={{ x: 1000 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        headerTitle="AI 提供商"
        toolBarRender={() => [
          <Button
            key="check-all"
            icon={<HeartOutlined />}
            onClick={() => checkAllMutation.mutate()}
            loading={checkAllMutation.isPending}
          >
            批量健康检查
          </Button>,
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setFormVisible(true);
            }}
          >
            新增提供商
          </Button>,
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />

      <Modal
        title={editing ? '编辑提供商' : '新增提供商'}
        open={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="例如: OpenAI Production" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(PROVIDER_TYPE_CONFIG).map(([value, cfg]) => ({
                label: cfg.label,
                value,
              }))}
            />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={editing ? [] : [{ required: true }]}>
            <Input.Password placeholder={editing ? '留空则不修改' : '输入 API Key'} />
          </Form.Item>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" defaultChecked />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="timeout" label="超时时间(ms)">
                <InputNumber
                  min={1000}
                  max={120000}
                  style={{ width: '100%' }}
                  placeholder="30000"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="retryCount" label="重试次数">
                <InputNumber min={0} max={5} style={{ width: '100%' }} placeholder="3" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="healthCheckUrl" label="健康检查 URL">
            <Input placeholder="可选，用于定期检查连通性" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// ==================== Model Tab ====================

const ModelTab: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<ModelInfoDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);
  const [allData, setAllData] = useState<ModelInfoDto[]>([]);

  const createMutation = useCreateModel({
    onSuccess: () => {
      message.success('创建成功');
      setFormVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateModel({
    onSuccess: () => {
      message.success('更新成功');
      setFormVisible(false);
      setEditing(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteModel({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const testMutation = useTestModel({
    onSuccess: (result: any) => {
      if (result.success) {
        message.success(
          `模型测试成功 (${result.latency}ms, tokens: ${result.usage?.inputTokens || 0}/${result.usage?.outputTokens || 0})`
        );
      } else {
        message.warning(`测试失败: ${result.error}`);
      }
    },
    onError: (e: any) => message.error(`测试失败: ${e.message}`),
  });

  const handleEdit = (record: ModelInfoDto) => {
    setEditing(record);
    form.setFieldsValue({
      providerId: record.providerId,
      modelName: record.modelName,
      displayName: record.displayName,
      capabilityType: record.capabilityType,
      enabled: record.enabled,
      priority: record.priority,
    });
    setFormVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  // 概览
  const overview = useMemo(() => {
    if (!allData.length) return null;
    const total = allData.length;
    const enabled = allData.filter((m) => m.enabled).length;
    const capDist = allData.reduce(
      (acc, m) => {
        const cap = m.capabilityType || 'unknown';
        acc[cap] = (acc[cap] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return { total, enabled, disabled: total - enabled, capDist };
  }, [allData]);

  const columns: ProColumns<ModelInfoDto>[] = [
    {
      title: '模型名称',
      dataIndex: 'modelName',
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.displayName || record.modelName}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.modelName}
          </Text>
        </Space>
      ),
    },
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      width: 120,
      render: (v) => <Tag color="blue">{v as string}</Tag>,
    },
    {
      title: '提供商',
      dataIndex: 'providerId',
      width: 120,
      search: false,
      render: (_, record: any) => (
        <Text type="secondary">{record.provider?.name || record.providerId}</Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      search: false,
      render: (enabled) =>
        enabled ? <Tag color="success">启用</Tag> : <Tag color="default">禁用</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      search: false,
      sorter: true,
      render: (v) => <Text>{v as number}</Text>,
    },
    {
      title: '操作',
      width: 200,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() =>
              testMutation.mutate({ modelId: record.id, input: { prompt: 'Hi' } } as any)
            }
            loading={testMutation.isPending}
          >
            测试
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
            title="确认删除此模型？"
            onConfirm={() => deleteMutation.mutate(record.id as any)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {overview && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="模型总数" value={overview.total} prefix={<RobotOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已启用"
                value={overview.enabled}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="已禁用" value={overview.disabled} valueStyle={{ color: '#999' }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Space wrap>
                {Object.entries(overview.capDist).map(([cap, count]) => (
                  <Tag key={cap} color="blue">
                    {cap}: {count}
                  </Tag>
                ))}
              </Space>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                能力分布
              </Text>
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<ModelInfoDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const res = await modelApi.getModels({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.modelName,
            capabilityType: params.capabilityType,
          });
          setAllData((res as any).list || []);
          return {
            data: (res as any).list || [],
            total: (res as any).total || 0,
            success: true,
          };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        headerTitle="AI 模型"
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setFormVisible(true);
            }}
          >
            新增模型
          </Button>,
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />

      <Modal
        title={editing ? '编辑模型' : '新增模型'}
        open={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="providerId" label="提供商 ID" rules={[{ required: true }]}>
            <Input placeholder="提供商 UUID" />
          </Form.Item>
          <Form.Item name="modelName" label="模型名称" rules={[{ required: true }]}>
            <Input placeholder="例如: gpt-4o" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="例如: GPT-4o" />
          </Form.Item>
          <Form.Item name="capabilityType" label="能力类型" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '对话', value: 'chat' },
                { label: '分析', value: 'analysis' },
                { label: '推荐', value: 'recommendation' },
                { label: '嵌入', value: 'embedding' },
                { label: '图像', value: 'image' },
              ]}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" defaultChecked />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="0 (越大越优先)" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// ==================== 主组件 ====================

const AIServiceManagement: React.FC = () => {
  return (
    <div style={{ padding: 0 }}>
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message="AI 服务管理"
        description="管理 AI 提供商（OpenAI、Azure等）和模型配置。可测试连通性、切换启用状态、调整优先级。"
        style={{ marginBottom: 16 }}
      />
      <Tabs
        defaultActiveKey="providers"
        items={[
          {
            key: 'providers',
            label: (
              <Space>
                <CloudServerOutlined />
                提供商管理
              </Space>
            ),
            children: <ProviderTab />,
          },
          {
            key: 'models',
            label: (
              <Space>
                <RobotOutlined />
                模型管理
              </Space>
            ),
            children: <ModelTab />,
          },
        ]}
      />
    </div>
  );
};

export default AIServiceManagement;
