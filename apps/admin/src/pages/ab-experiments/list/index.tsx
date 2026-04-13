import React, { useRef, useState, useMemo } from 'react';
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
  InputNumber,
  Select,
  Slider,
  DatePicker,
  Popconfirm,
  Tooltip,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  abExperimentApi,
  useExperimentOverview,
  useCreateExperiment,
  useUpdateExperimentStatus,
  type ExperimentDto,
  type ExperimentStatus,
  type CreateExperimentDto,
} from '@/services/abExperimentService';

// ==================== 常量配置 ====================

const statusConfig: Record<ExperimentStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  running: { color: 'processing', text: '运行中' },
  paused: { color: 'warning', text: '已暂停' },
  completed: { color: 'success', text: '已完成' },
};

export const routeConfig = {
  name: 'ab-experiment-list',
  title: '实验管理',
  icon: 'UnorderedListOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 主组件 ====================

const ABExperimentList: React.FC = () => {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  // 结构化分组数据
  const [createGroups, setCreateGroups] = useState<{ name: string; trafficRatio: number }[]>([
    { name: 'control', trafficRatio: 0.5 },
    { name: 'variant_a', trafficRatio: 0.5 },
  ]);

  // 始终加载概览数据
  const { data: overview, isLoading: overviewLoading } = useExperimentOverview();

  const createMutation = useCreateExperiment({
    onSuccess: () => {
      message.success('实验创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`创建失败: ${error.message}`),
  });

  const statusMutation = useUpdateExperimentStatus({
    onSuccess: () => {
      message.success('状态更新成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`状态更新失败: ${error.message}`),
  });

  // 复制实验：预填表单
  const handleClone = (record: ExperimentDto) => {
    const groups = (record.groups || []).map((g) => ({
      name: g.name,
      trafficRatio: g.trafficRatio,
    }));
    setCreateGroups(
      groups.length >= 2
        ? groups
        : [
            { name: 'control', trafficRatio: 0.5 },
            { name: 'variant_a', trafficRatio: 0.5 },
          ]
    );
    createForm.setFieldsValue({
      name: `${record.name} (副本)`,
      description: record.description || '',
      goalType: record.goalType || '*',
    });
    setCreateModalVisible(true);
  };

  // ==================== 概览统计卡片 ====================

  const overviewCards = useMemo(() => {
    if (!overview) return null;
    const items = [
      {
        title: '实验总数',
        value: overview.total,
        icon: <ExperimentOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
        color: undefined,
      },
      {
        title: '运行中',
        value: overview.running,
        icon: <RocketOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
        color: '#1677ff',
        suffix:
          overview.total > 0
            ? `(${((overview.running / overview.total) * 100).toFixed(0)}%)`
            : undefined,
      },
      {
        title: '草稿',
        value: overview.draft,
        icon: <FileTextOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />,
        color: undefined,
      },
      {
        title: '已暂停',
        value: overview.paused,
        icon: <ClockCircleOutlined style={{ fontSize: 24, color: '#faad14' }} />,
        color: '#faad14',
      },
      {
        title: '已完成',
        value: overview.completed,
        icon: <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
        color: '#52c41a',
      },
    ];
    return items;
  }, [overview]);

  // ==================== 列定义 ====================

  const columns: ProColumns<ExperimentDto>[] = [
    {
      title: '实验名称',
      dataIndex: 'name',
      ellipsis: true,
      width: 200,
    },
    {
      title: '目标类型',
      dataIndex: 'goalType',
      width: 100,
      render: (_, record) => (
        <Tag color={record.goalType === '*' ? 'blue' : 'green'}>
          {record.goalType === '*' ? '全部' : record.goalType}
        </Tag>
      ),
      hideInSearch: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        draft: { text: '草稿', status: 'Default' },
        running: { text: '运行中', status: 'Processing' },
        paused: { text: '已暂停', status: 'Warning' },
        completed: { text: '已完成', status: 'Success' },
      },
      render: (_, record) => {
        const cfg = statusConfig[record.status];
        return record.status === 'running' ? (
          <Badge status="processing" text={<Tag color={cfg.color}>{cfg.text}</Tag>} />
        ) : (
          <Tag color={cfg.color}>{cfg.text}</Tag>
        );
      },
    },
    {
      title: '分组',
      key: 'groups',
      width: 200,
      hideInSearch: true,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {record.groups?.map((g) => (
            <Tag key={g.name} color="processing">
              {g.name}: {(g.trafficRatio * 100).toFixed(0)}%
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '时间范围',
      key: 'timeRange',
      width: 180,
      hideInSearch: true,
      render: (_, record) => {
        const start = record.startDate
          ? new Date(record.startDate).toLocaleDateString('zh-CN')
          : '-';
        const end = record.endDate ? new Date(record.endDate).toLocaleDateString('zh-CN') : '-';
        return (
          <span style={{ fontSize: 12 }}>
            {start} ~ {end}
          </span>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateTime',
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '关键字',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜索实验名称' },
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
            onClick={() => navigate(`/ab-experiments/detail/${record.id}`)}
          >
            详情
          </Button>
          <Tooltip title="以此实验为模板创建新实验">
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
              title="启动实验"
              description="启动后将开始分流用户，确认？"
              onConfirm={() => statusMutation.mutate({ id: record.id, status: 'running' })}
            >
              <Button type="link" size="small" icon={<PlayCircleOutlined />}>
                启动
              </Button>
            </Popconfirm>
          )}
          {record.status === 'running' && (
            <>
              <Popconfirm
                title="暂停实验"
                description="暂停后将停止分流，确认？"
                onConfirm={() => statusMutation.mutate({ id: record.id, status: 'paused' })}
              >
                <Button type="link" size="small" icon={<PauseCircleOutlined />}>
                  暂停
                </Button>
              </Popconfirm>
              <Popconfirm
                title="结束实验"
                description="结束后将标记为完成，确认？"
                onConfirm={() => statusMutation.mutate({ id: record.id, status: 'completed' })}
              >
                <Button type="link" size="small" danger icon={<CheckCircleOutlined />}>
                  完成
                </Button>
              </Popconfirm>
            </>
          )}
          {record.status === 'paused' && (
            <>
              <Popconfirm
                title="恢复实验"
                description="恢复后将继续分流用户，确认？"
                onConfirm={() => statusMutation.mutate({ id: record.id, status: 'running' })}
              >
                <Button type="link" size="small" icon={<PlayCircleOutlined />}>
                  恢复
                </Button>
              </Popconfirm>
              <Popconfirm
                title="结束实验"
                description="结束后将标记为完成且不可恢复，确认？"
                onConfirm={() => statusMutation.mutate({ id: record.id, status: 'completed' })}
              >
                <Button type="link" size="small" danger icon={<CheckCircleOutlined />}>
                  完成
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  // ==================== 分组操作 ====================

  const trafficSum = createGroups.reduce((s, g) => s + g.trafficRatio, 0);

  const addGroup = () => {
    setCreateGroups((prev) => [
      ...prev,
      { name: `variant_${String.fromCharCode(97 + prev.length - 1)}`, trafficRatio: 0 },
    ]);
  };

  const removeGroup = (idx: number) => {
    if (createGroups.length <= 2) return;
    setCreateGroups((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateGroup = (idx: number, field: 'name' | 'trafficRatio', value: string | number) => {
    setCreateGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, [field]: value } : g)));
  };

  // ==================== 创建弹窗提交 ====================

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();

      // 校验分组流量总和
      if (Math.abs(trafficSum - 1.0) > 0.01) {
        message.error(`流量分配总和必须为 100%，当前为 ${(trafficSum * 100).toFixed(0)}%`);
        return;
      }
      // 校验分组名称非空
      if (createGroups.some((g) => !g.name.trim())) {
        message.error('分组名称不能为空');
        return;
      }

      const dto: CreateExperimentDto = {
        name: values.name,
        description: values.description,
        goalType: values.goalType || '*',
        groups: createGroups,
        startDate: values.startDate?.toISOString(),
        endDate: values.endDate?.toISOString(),
      };
      createMutation.mutate(dto);
    } catch (err: any) {
      if (err?.errorFields) return;
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 常驻概览统计卡片行 */}
      <Row gutter={[16, 16]}>
        {(overviewCards || []).map((item) => (
          <Col key={item.title} xs={12} sm={8} md={6} lg={4} xl={4}>
            <Card size="small" loading={overviewLoading} variant="borderless">
              <Statistic
                title={item.title}
                value={item.value}
                prefix={item.icon}
                suffix={
                  item.suffix ? (
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>{item.suffix}</span>
                  ) : undefined
                }
                valueStyle={item.color ? { color: item.color } : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 实验列表 */}
      <ProTable<ExperimentDto>
        headerTitle="A/B 实验管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1300 }}
        request={async (params) => {
          const { current, pageSize, keyword, status } = params;
          const res = await abExperimentApi.getExperiments({
            page: current,
            pageSize,
            keyword: keyword || undefined,
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
            onClick={() => {
              createForm.resetFields();
              createForm.setFieldsValue({ goalType: '*' });
              setCreateGroups([
                { name: 'control', trafficRatio: 0.5 },
                { name: 'variant_a', trafficRatio: 0.5 },
              ]);
              setCreateModalVisible(true);
            }}
          >
            创建实验
          </Button>,
        ]}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 创建 / 复制实验弹窗 */}
      <Modal
        title="创建 A/B 实验"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
          setCreateGroups([
            { name: 'control', trafficRatio: 0.5 },
            { name: 'variant_a', trafficRatio: 0.5 },
          ]);
        }}
        onOk={handleCreate}
        confirmLoading={createMutation.isPending}
        width={640}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="实验名称"
            rules={[{ required: true, message: '请输入实验名称' }]}
          >
            <Input placeholder="例：减脂评分权重优化 v2" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="实验描述（可选）" />
          </Form.Item>
          <Form.Item name="goalType" label="目标类型" initialValue="*">
            <Select
              options={[
                { label: '全部目标 (*)', value: '*' },
                { label: '减脂 (fat_loss)', value: 'fat_loss' },
                { label: '增肌 (muscle_gain)', value: 'muscle_gain' },
                { label: '健康 (health)', value: 'health' },
                { label: '习惯养成 (habit)', value: 'habit' },
              ]}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="startDate" label="开始时间">
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endDate" label="结束时间">
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {/* 结构化分组编辑器 */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span style={{ fontWeight: 500 }}>
                分组配置{' '}
                <span
                  style={{
                    fontSize: 12,
                    color: Math.abs(trafficSum - 1.0) <= 0.01 ? '#52c41a' : '#ff4d4f',
                    marginLeft: 8,
                  }}
                >
                  流量总和: {(trafficSum * 100).toFixed(0)}%
                </span>
              </span>
              <Button size="small" icon={<PlusOutlined />} onClick={addGroup}>
                添加分组
              </Button>
            </div>
            {createGroups.map((g, idx) => (
              <Card
                key={idx}
                size="small"
                style={{ marginBottom: 8 }}
                extra={
                  createGroups.length > 2 ? (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => removeGroup(idx)}
                    />
                  ) : null
                }
                title={
                  <Tag color={idx === 0 ? 'blue' : 'green'}>
                    {idx === 0 ? '对照组' : `实验组 ${idx}`}
                  </Tag>
                }
              >
                <Row gutter={12} align="middle">
                  <Col span={8}>
                    <Input
                      size="small"
                      value={g.name}
                      onChange={(e) => updateGroup(idx, 'name', e.target.value)}
                      placeholder="分组名称"
                    />
                  </Col>
                  <Col span={12}>
                    <Slider
                      min={0}
                      max={100}
                      value={Math.round(g.trafficRatio * 100)}
                      onChange={(v) => updateGroup(idx, 'trafficRatio', v / 100)}
                    />
                  </Col>
                  <Col span={4}>
                    <InputNumber
                      size="small"
                      min={0}
                      max={100}
                      value={Math.round(g.trafficRatio * 100)}
                      onChange={(v) => updateGroup(idx, 'trafficRatio', (v || 0) / 100)}
                      formatter={(v) => `${v}%`}
                      parser={(v) => Number(v?.replace('%', '') || 0) as 0}
                      style={{ width: '100%' }}
                    />
                  </Col>
                </Row>
              </Card>
            ))}
          </div>
        </Form>
      </Modal>
    </Space>
  );
};

export default ABExperimentList;
