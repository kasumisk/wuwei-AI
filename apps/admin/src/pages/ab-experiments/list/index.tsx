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
  DatePicker,
  Popconfirm,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  BarChartOutlined,
  DeleteOutlined,
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
  type ExperimentGroup,
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
  const [overviewVisible, setOverviewVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();

  const { data: overview } = useExperimentOverview({ enabled: overviewVisible });

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
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '分组数',
      key: 'groupCount',
      width: 80,
      hideInSearch: true,
      render: (_, record) => <Tag>{record.groups?.length || 0} 组</Tag>,
    },
    {
      title: '分组详情',
      key: 'groups',
      width: 250,
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
      title: '开始时间',
      dataIndex: 'startDate',
      width: 160,
      valueType: 'dateTime',
      hideInSearch: true,
      render: (_, record) => record.startDate || '-',
    },
    {
      title: '结束时间',
      dataIndex: 'endDate',
      width: 160,
      valueType: 'dateTime',
      hideInSearch: true,
      render: (_, record) => record.endDate || '-',
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
      width: 240,
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
            <Popconfirm
              title="暂停实验"
              description="暂停后将停止分流，确认？"
              onConfirm={() => statusMutation.mutate({ id: record.id, status: 'paused' })}
            >
              <Button type="link" size="small" icon={<PauseCircleOutlined />}>
                暂停
              </Button>
            </Popconfirm>
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
                <Button type="link" size="small" icon={<CheckCircleOutlined />}>
                  完成
                </Button>
              </Popconfirm>
            </>
          )}
          {(record.status === 'running' || record.status === 'paused') && (
            <Popconfirm
              title="结束实验"
              description="结束后将标记为完成，确认？"
              onConfirm={() => statusMutation.mutate({ id: record.id, status: 'completed' })}
            >
              <Button type="link" size="small" danger icon={<CheckCircleOutlined />}>
                完成
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
      let groups: ExperimentGroup[];
      try {
        groups = JSON.parse(values.groups);
        if (!Array.isArray(groups)) throw new Error('分组配置必须是数组');
      } catch (e: any) {
        message.error(`分组 JSON 格式错误: ${e.message}`);
        return;
      }

      const dto: CreateExperimentDto = {
        name: values.name,
        description: values.description,
        goalType: values.goalType || '*',
        groups,
        startDate: values.startDate?.toISOString(),
        endDate: values.endDate?.toISOString(),
      };
      createMutation.mutate(dto);
    } catch (err: any) {
      if (err?.errorFields) return;
    }
  };

  return (
    <>
      <ProTable<ExperimentDto>
        headerTitle="A/B 实验管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 1400 }}
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
            key="overview"
            icon={<BarChartOutlined />}
            onClick={() => setOverviewVisible(true)}
          >
            统计概览
          </Button>,
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建实验
          </Button>,
        ]}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 统计概览弹窗 */}
      <Modal
        title="A/B 实验统计概览"
        open={overviewVisible}
        onCancel={() => setOverviewVisible(false)}
        footer={null}
        width={600}
      >
        {overview && (
          <Row gutter={[16, 16]}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="实验总数" value={overview.total} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="运行中"
                  value={overview.running}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="草稿" value={overview.draft} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="已暂停"
                  value={overview.paused}
                  valueStyle={{ color: '#faad14' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="已完成"
                  value={overview.completed}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Modal>

      {/* 创建实验弹窗 */}
      <Modal
        title="创建 A/B 实验"
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
          <Form.Item
            name="groups"
            label="分组配置 (JSON 数组)"
            rules={[
              { required: true, message: '请输入分组配置' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(value);
                    if (!Array.isArray(parsed)) return Promise.reject('必须是数组');
                    const total = parsed.reduce(
                      (s: number, g: any) => s + (g.trafficRatio || 0),
                      0
                    );
                    if (Math.abs(total - 1.0) > 0.01)
                      return Promise.reject(`trafficRatio 之和必须为 1.0，当前为 ${total}`);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject('请输入有效的 JSON 数组');
                  }
                },
              },
            ]}
            initialValue={JSON.stringify(
              [
                { name: 'control', trafficRatio: 0.5 },
                { name: 'variant_a', trafficRatio: 0.5 },
              ],
              null,
              2
            )}
          >
            <Input.TextArea
              rows={8}
              style={{ fontFamily: 'monospace' }}
              placeholder='[{"name": "control", "trafficRatio": 0.5}, {"name": "variant_a", "trafficRatio": 0.5}]'
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default ABExperimentList;
