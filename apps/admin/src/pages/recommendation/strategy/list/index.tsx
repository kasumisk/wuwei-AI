import React, { useRef, useState } from 'react';
import {
  Card,
  Button,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  message,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  StopOutlined,
  GlobalOutlined,
  UserOutlined,
  ExperimentOutlined,
  AimOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  FileOutlined,
  InboxOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  strategyApi,
  useStrategyOverview,
  useCreateStrategy,
  useActivateStrategy,
  useArchiveStrategy,
  type StrategyDto,
  type StrategyScope,
  type StrategyStatus,
  type CreateStrategyDto,
} from '@/services/strategyManagementService';

// ==================== 常量配置 ====================

const scopeConfig: Record<StrategyScope, { color: string; icon: React.ReactNode; text: string }> = {
  global: { color: 'blue', icon: <GlobalOutlined />, text: '全局' },
  goal_type: { color: 'green', icon: <AimOutlined />, text: '目标类型' },
  experiment: { color: 'purple', icon: <ExperimentOutlined />, text: '实验' },
  user: { color: 'orange', icon: <UserOutlined />, text: '用户' },
};

const statusConfig: Record<StrategyStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  active: { color: 'success', text: '激活' },
  archived: { color: 'warning', text: '已归档' },
};

export const routeConfig = {
  name: 'strategy-list',
  title: '策略管理',
  icon: 'UnorderedListOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 主组件 ====================

const StrategyList: React.FC = () => {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();

  // 始终加载概览统计
  const { data: overview, isLoading: overviewLoading } = useStrategyOverview();

  const createMutation = useCreateStrategy({
    onSuccess: () => {
      message.success('策略创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`创建失败: ${error.message}`),
  });

  const activateMutation = useActivateStrategy({
    onSuccess: () => {
      message.success('策略已激活');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`激活失败: ${error.message}`),
  });

  const archiveMutation = useArchiveStrategy({
    onSuccess: () => {
      message.success('策略已归档');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`归档失败: ${error.message}`),
  });

  // ==================== 复制策略 ====================

  const handleClone = (record: StrategyDto) => {
    createForm.setFieldsValue({
      name: `${record.name} (副本)`,
      description: record.description || '',
      scope: record.scope,
      scopeTarget: record.scopeTarget || '',
      priority: record.priority,
      config: JSON.stringify(record.config, null, 2),
    });
    setCreateModalVisible(true);
  };

  // ==================== 列定义 ====================

  const columns: ProColumns<StrategyDto>[] = [
    {
      title: '策略名称',
      dataIndex: 'name',
      ellipsis: true,
      width: 200,
    },
    {
      title: '范围',
      dataIndex: 'scope',
      width: 120,
      valueType: 'select',
      valueEnum: {
        global: { text: '全局' },
        goal_type: { text: '目标类型' },
        experiment: { text: '实验' },
        user: { text: '用户' },
      },
      render: (_, record) => {
        const cfg = scopeConfig[record.scope];
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '范围目标',
      dataIndex: 'scopeTarget',
      width: 120,
      ellipsis: true,
      render: (_, record) => record.scopeTarget || '-',
      hideInSearch: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        draft: { text: '草稿', status: 'Default' },
        active: { text: '激活', status: 'Success' },
        archived: { text: '已归档', status: 'Warning' },
      },
      render: (_, record) => {
        const cfg = statusConfig[record.status];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
      hideInSearch: true,
      render: (_, record) => <Tag>v{record.version}</Tag>,
    },
    {
      title: '配置模块',
      key: 'configModules',
      width: 200,
      hideInSearch: true,
      render: (_, record) => {
        const modules = Object.keys(record.config || {}).filter(
          (k) => record.config[k as keyof typeof record.config] != null
        );
        if (modules.length === 0) return <Tag color="default">空配置</Tag>;
        return (
          <Space size={[4, 4]} wrap>
            {modules.map((m) => (
              <Tag key={m} color="processing">
                {m}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      valueType: 'dateTime',
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '关键字',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜索策略名称' },
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      fixed: 'right',
      hideInSearch: true,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/recommendation/strategy/detail/${record.id}`)}
          >
            详情
          </Button>
          <Tooltip title="复制策略配置创建新策略">
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleClone(record)}
            >
              复制
            </Button>
          </Tooltip>
          {record.status === 'draft' && (
            <Popconfirm
              title="激活策略"
              description="激活后将替换同范围的现有激活策略，确认？"
              onConfirm={() => activateMutation.mutate(record.id)}
            >
              <Button type="link" size="small" icon={<PlayCircleOutlined />}>
                激活
              </Button>
            </Popconfirm>
          )}
          {record.status === 'active' && (
            <Popconfirm
              title="归档策略"
              description="归档后策略将不再生效且不可修改，确认？"
              onConfirm={() => archiveMutation.mutate(record.id)}
            >
              <Button type="link" size="small" danger icon={<StopOutlined />}>
                归档
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ==================== 创建弹窗提交 ====================

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const dto: CreateStrategyDto = {
        name: values.name,
        description: values.description,
        scope: values.scope,
        scopeTarget: values.scopeTarget || undefined,
        config: values.config ? JSON.parse(values.config) : {},
        priority: values.priority || 0,
      };
      createMutation.mutate(dto);
    } catch (err: any) {
      if (err?.errorFields) return; // 校验失败
      message.error(`配置 JSON 解析失败`);
    }
  };

  return (
    <>
      {/* 常驻统计卡片行 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Statistic
              title="策略总数"
              value={overview?.totalStrategies ?? '-'}
              prefix={<FileOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Statistic
              title="激活中"
              value={overview?.activeStrategies ?? '-'}
              valueStyle={{ color: '#52c41a' }}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Statistic
              title="草稿"
              value={overview?.draftStrategies ?? '-'}
              prefix={<InboxOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Statistic
              title="已归档"
              value={overview?.archivedStrategies ?? '-'}
              valueStyle={{ color: '#faad14' }}
              prefix={<StopOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Statistic
              title="活跃分配"
              value={overview?.totalActiveAssignments ?? '-'}
              valueStyle={{ color: '#1677ff' }}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" loading={overviewLoading}>
            <Space wrap size={[4, 4]}>
              {overview?.scopeDistribution.map((item) => (
                <Tag
                  key={item.scope}
                  color={scopeConfig[item.scope as StrategyScope]?.color || 'default'}
                >
                  {scopeConfig[item.scope as StrategyScope]?.text || item.scope}: {item.count}
                </Tag>
              )) ?? <span style={{ color: '#999' }}>-</span>}
            </Space>
          </Card>
        </Col>
      </Row>

      <ProTable<StrategyDto>
        headerTitle="推荐策略管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1200 }}
        request={async (params) => {
          const { current, pageSize, keyword, scope, status } = params;
          const res = await strategyApi.getStrategies({
            page: current,
            pageSize,
            keyword: keyword || undefined,
            scope: scope || undefined,
            status: status || undefined,
          });
          return {
            data: res.list,
            total: res.total,
            success: true,
          };
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
            onClick={() => setCreateModalVisible(true)}
          >
            创建策略
          </Button>,
        ]}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 创建策略弹窗 */}
      <Modal
        title="创建推荐策略"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={createMutation.isPending}
        width={640}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="策略名称"
            rules={[{ required: true, message: '请输入策略名称' }]}
          >
            <Input placeholder="例：减脂高蛋白策略 v2" maxLength={128} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="策略说明（可选）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="scope"
                label="策略范围"
                rules={[{ required: true, message: '请选择范围' }]}
              >
                <Select
                  placeholder="请选择"
                  options={[
                    { label: '全局', value: 'global' },
                    { label: '目标类型', value: 'goal_type' },
                    { label: '实验', value: 'experiment' },
                    { label: '用户', value: 'user' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="scopeTarget" label="范围目标">
                <Input placeholder="如 fat_loss / 实验ID / 用户ID" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="priority" label="优先级" initialValue={0}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="config"
            label="策略配置 (JSON)"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject('请输入有效的 JSON');
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              rows={6}
              placeholder='{"rank": {}, "boost": {}, ...}'
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default StrategyList;
