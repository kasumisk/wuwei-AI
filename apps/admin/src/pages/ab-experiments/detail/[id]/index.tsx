import React, { useState } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Space,
  Button,
  Tabs,
  Table,
  Spin,
  Alert,
  Row,
  Col,
  Statistic,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  message,
  Popconfirm,
  Result,
} from 'antd';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  EditOutlined,
  TrophyOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  useExperimentDetail,
  useExperimentMetrics,
  useExperimentAnalysis,
  useUpdateExperiment,
  useUpdateExperimentStatus,
  type ExperimentDto,
  type ExperimentStatus,
  type ExperimentMetric,
  type ExperimentAnalysis,
  type UpdateExperimentDto,
} from '@/services/abExperimentService';

const { Text, Paragraph } = Typography;

const statusConfig: Record<ExperimentStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  running: { color: 'processing', text: '运行中' },
  paused: { color: 'warning', text: '已暂停' },
  completed: { color: 'success', text: '已完成' },
};

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];

export const routeConfig = {
  name: 'ab-experiment-detail',
  title: '实验详情',
  hideInMenu: true,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 指标图表组件 ====================

const MetricsChart: React.FC<{ metrics: ExperimentMetric[] }> = ({ metrics }) => {
  if (!metrics?.length) return <Alert message="暂无指标数据" type="info" showIcon />;

  const chartData = metrics.map((m) => ({
    group: m.groupId,
    接受率: Math.round(m.acceptanceRate * 10000) / 100,
    替换率:
      m.totalRecommendations > 0
        ? Math.round((m.replacedCount / m.totalRecommendations) * 10000) / 100
        : 0,
    跳过率:
      m.totalRecommendations > 0
        ? Math.round((m.skippedCount / m.totalRecommendations) * 10000) / 100
        : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="group" />
        <YAxis unit="%" />
        <Tooltip formatter={(value: number) => `${value}%`} />
        <Legend />
        <Bar dataKey="接受率" fill="#52c41a" />
        <Bar dataKey="替换率" fill="#faad14" />
        <Bar dataKey="跳过率" fill="#f5222d" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// ==================== 分析报告组件 ====================

const AnalysisReport: React.FC<{ analysis: ExperimentAnalysis }> = ({ analysis }) => {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* 结论 */}
      <Alert
        message={
          <Space>
            {analysis.canConclude ? (
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            ) : (
              <WarningOutlined style={{ color: '#faad14' }} />
            )}
            <Text strong>{analysis.canConclude ? '实验可结论' : '数据不足'}</Text>
          </Space>
        }
        description={analysis.conclusion}
        type={analysis.canConclude ? 'success' : 'warning'}
        showIcon={false}
      />

      {/* 获胜组 */}
      {analysis.winner && (
        <Card size="small">
          <Result
            icon={<TrophyOutlined style={{ color: '#faad14' }} />}
            title={`获胜组: ${analysis.winner}`}
            subTitle={analysis.conclusion}
            status="info"
          />
        </Card>
      )}

      {/* 两两比较 */}
      {analysis.comparisons.length > 0 && (
        <Card title="统计显著性比较" size="small">
          <Table
            dataSource={analysis.comparisons}
            rowKey={(r) => `${r.controlGroup}-${r.treatmentGroup}`}
            pagination={false}
            size="small"
            columns={[
              { title: '对照组', dataIndex: 'controlGroup', width: 120 },
              { title: '实验组', dataIndex: 'treatmentGroup', width: 120 },
              {
                title: '是否显著',
                key: 'significant',
                width: 100,
                render: (_, r) =>
                  r.significance.significant ? (
                    <Tag color="success">显著</Tag>
                  ) : (
                    <Tag color="default">不显著</Tag>
                  ),
              },
              {
                title: '卡方统计量',
                key: 'chiSquared',
                width: 120,
                render: (_, r) => r.significance.chiSquared.toFixed(4),
              },
              {
                title: 'p 值',
                key: 'pValue',
                width: 100,
                render: (_, r) => (
                  <Text type={r.significance.pValue < 0.05 ? 'success' : undefined}>
                    {r.significance.pValue.toFixed(4)}
                  </Text>
                ),
              },
              {
                title: '接受率提升',
                key: 'lift',
                width: 120,
                render: (_, r) => (
                  <Text type={r.acceptanceRateLift > 0 ? 'success' : 'danger'}>
                    {r.acceptanceRateLift > 0 ? '+' : ''}
                    {r.acceptanceRateLift}%
                  </Text>
                ),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
};

// ==================== 主组件 ====================

const ABExperimentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();

  const { data: experiment, isLoading } = useExperimentDetail(id!, !!id);
  const { data: metricsData, isLoading: metricsLoading } = useExperimentMetrics(
    id!,
    !!id && experiment?.status !== 'draft'
  );
  const { data: analysis, isLoading: analysisLoading } = useExperimentAnalysis(
    id!,
    !!id && experiment?.status !== 'draft'
  );

  const updateMutation = useUpdateExperiment({
    onSuccess: () => {
      message.success('实验更新成功');
      setEditModalVisible(false);
    },
    onError: (error: any) => message.error(`更新失败: ${error.message}`),
  });

  const statusMutation = useUpdateExperimentStatus({
    onSuccess: () => message.success('状态更新成功'),
    onError: (error: any) => message.error(`状态更新失败: ${error.message}`),
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!experiment) return <Alert message="实验不存在" type="error" showIcon />;

  const cfg = statusConfig[experiment.status];

  // 编辑弹窗打开
  const openEdit = () => {
    editForm.setFieldsValue({
      name: experiment.name,
      description: experiment.description,
      goalType: experiment.goalType,
      groups: JSON.stringify(experiment.groups, null, 2),
    });
    setEditModalVisible(true);
  };

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields();
      const dto: UpdateExperimentDto = {
        name: values.name,
        description: values.description,
        goalType: values.goalType,
      };
      if (values.groups) {
        dto.groups = JSON.parse(values.groups);
      }
      updateMutation.mutate({ id: id!, data: dto });
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('JSON 解析失败');
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* 头部 */}
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ab-experiments/list')}>
            返回列表
          </Button>
          {(experiment.status === 'draft' || experiment.status === 'paused') && (
            <Button icon={<EditOutlined />} onClick={openEdit}>
              编辑
            </Button>
          )}
          {experiment.status === 'draft' && (
            <Popconfirm
              title="启动实验？"
              onConfirm={() => statusMutation.mutate({ id: id!, status: 'running' })}
            >
              <Button type="primary" icon={<PlayCircleOutlined />}>
                启动
              </Button>
            </Popconfirm>
          )}
          {experiment.status === 'running' && (
            <Popconfirm
              title="暂停实验？"
              onConfirm={() => statusMutation.mutate({ id: id!, status: 'paused' })}
            >
              <Button icon={<PauseCircleOutlined />}>暂停</Button>
            </Popconfirm>
          )}
          {experiment.status === 'paused' && (
            <>
              <Popconfirm
                title="恢复实验？"
                onConfirm={() => statusMutation.mutate({ id: id!, status: 'running' })}
              >
                <Button type="primary" icon={<PlayCircleOutlined />}>
                  恢复
                </Button>
              </Popconfirm>
              <Popconfirm
                title="标记为完成？"
                onConfirm={() => statusMutation.mutate({ id: id!, status: 'completed' })}
              >
                <Button icon={<CheckCircleOutlined />}>完成</Button>
              </Popconfirm>
            </>
          )}
        </Space>

        <Descriptions bordered column={2}>
          <Descriptions.Item label="实验名称" span={2}>
            {experiment.name}
          </Descriptions.Item>
          <Descriptions.Item label="实验 ID">{experiment.id}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={cfg.color}>{cfg.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="目标类型">
            <Tag color={experiment.goalType === '*' ? 'blue' : 'green'}>
              {experiment.goalType === '*' ? '全部' : experiment.goalType}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="分组数">{experiment.groups?.length || 0} 组</Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {experiment.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="开始时间">{experiment.startDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="结束时间">{experiment.endDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{experiment.createdAt}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{experiment.updatedAt}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 分组配置 */}
      <Card title="分组配置" size="small">
        <Table
          dataSource={experiment.groups || []}
          rowKey="name"
          pagination={false}
          size="small"
          columns={[
            {
              title: '分组名称',
              dataIndex: 'name',
              width: 150,
              render: (name: string) => (
                <Tag color={name.toLowerCase().includes('control') ? 'blue' : 'green'}>{name}</Tag>
              ),
            },
            {
              title: '流量占比',
              dataIndex: 'trafficRatio',
              width: 120,
              render: (ratio: number) => `${(ratio * 100).toFixed(0)}%`,
            },
            {
              title: '评分权重覆盖',
              dataIndex: 'scoreWeightOverrides',
              render: (val: any) =>
                val ? (
                  <Paragraph
                    ellipsis={{ rows: 1, expandable: true }}
                    style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}
                  >
                    {JSON.stringify(val)}
                  </Paragraph>
                ) : (
                  <Text type="secondary">使用默认</Text>
                ),
            },
            {
              title: '餐次权重覆盖',
              dataIndex: 'mealWeightOverrides',
              render: (val: any) =>
                val ? (
                  <Paragraph
                    ellipsis={{ rows: 1, expandable: true }}
                    style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}
                  >
                    {JSON.stringify(val)}
                  </Paragraph>
                ) : (
                  <Text type="secondary">使用默认</Text>
                ),
            },
          ]}
        />
      </Card>

      {/* Tabs: 指标 / 分析报告 / 原始 JSON */}
      <Card>
        <Tabs
          items={[
            {
              key: 'metrics',
              label: (
                <span>
                  <BarChartOutlined /> 实验指标
                </span>
              ),
              children: metricsLoading ? (
                <Spin />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                  {/* 指标概览卡片 */}
                  {metricsData?.metrics && metricsData.metrics.length > 0 && (
                    <Row gutter={[16, 16]}>
                      {metricsData.metrics.map((m, i) => (
                        <Col
                          span={Math.max(6, Math.floor(24 / metricsData.metrics.length))}
                          key={m.groupId}
                        >
                          <Card
                            size="small"
                            title={<Tag color={COLORS[i % COLORS.length]}>{m.groupId}</Tag>}
                          >
                            <Row gutter={[8, 8]}>
                              <Col span={12}>
                                <Statistic
                                  title="样本量"
                                  value={m.sampleSize}
                                  valueStyle={{ fontSize: 18 }}
                                />
                              </Col>
                              <Col span={12}>
                                <Statistic
                                  title="总推荐数"
                                  value={m.totalRecommendations}
                                  valueStyle={{ fontSize: 18 }}
                                />
                              </Col>
                              <Col span={12}>
                                <Statistic
                                  title="接受率"
                                  value={(m.acceptanceRate * 100).toFixed(1)}
                                  suffix="%"
                                  valueStyle={{ fontSize: 18, color: '#52c41a' }}
                                />
                              </Col>
                              <Col span={12}>
                                <Statistic
                                  title="平均评分"
                                  value={m.avgNutritionScore.toFixed(2)}
                                  valueStyle={{ fontSize: 18 }}
                                />
                              </Col>
                            </Row>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}

                  {/* 指标对比图 */}
                  <Card title="分组指标对比" size="small">
                    <MetricsChart metrics={metricsData?.metrics || []} />
                  </Card>

                  {/* 指标明细表 */}
                  {metricsData?.metrics && (
                    <Card title="指标明细" size="small">
                      <Table
                        dataSource={metricsData.metrics}
                        rowKey="groupId"
                        pagination={false}
                        size="small"
                        columns={[
                          { title: '分组', dataIndex: 'groupId', width: 120 },
                          { title: '样本量', dataIndex: 'sampleSize', width: 80 },
                          { title: '总推荐', dataIndex: 'totalRecommendations', width: 80 },
                          { title: '接受', dataIndex: 'acceptedCount', width: 80 },
                          { title: '替换', dataIndex: 'replacedCount', width: 80 },
                          { title: '跳过', dataIndex: 'skippedCount', width: 80 },
                          {
                            title: '接受率',
                            key: 'rate',
                            width: 100,
                            render: (_, r) => (
                              <Text type="success">{(r.acceptanceRate * 100).toFixed(2)}%</Text>
                            ),
                          },
                          {
                            title: '平均评分',
                            dataIndex: 'avgNutritionScore',
                            width: 100,
                            render: (v: number) => v?.toFixed(3) || '-',
                          },
                        ]}
                      />
                    </Card>
                  )}
                </Space>
              ),
            },
            {
              key: 'analysis',
              label: (
                <span>
                  <ExperimentOutlined /> 分析报告
                </span>
              ),
              children: analysisLoading ? (
                <Spin />
              ) : analysis ? (
                <AnalysisReport analysis={analysis} />
              ) : (
                <Alert message="暂无分析数据" type="info" showIcon />
              ),
            },
            {
              key: 'json',
              label: '原始 JSON',
              children: (
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 8,
                    overflow: 'auto',
                    maxHeight: 500,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(experiment, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title="编辑 A/B 实验"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleEdit}
        confirmLoading={updateMutation.isPending}
        width={640}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="实验名称"
            rules={[{ required: true, message: '请输入实验名称' }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="goalType" label="目标类型">
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
          <Form.Item
            name="groups"
            label="分组配置 (JSON 数组)"
            rules={[
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
                      return Promise.reject(`trafficRatio 之和必须为 1.0`);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject('请输入有效的 JSON 数组');
                  }
                },
              },
            ]}
          >
            <Input.TextArea rows={8} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default ABExperimentDetail;
