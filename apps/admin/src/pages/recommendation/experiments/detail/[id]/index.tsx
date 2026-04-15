import React, { useState, useMemo } from 'react';
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
  message,
  Popconfirm,
  Result,
  Progress,
  Tooltip,
  Divider,
  Slider,
  InputNumber,
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
  RocketOutlined,
  CopyOutlined,
  TeamOutlined,
  SendOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ReferenceLine,
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

// ==================== 流量分配饼图 ====================

const TrafficPieChart: React.FC<{ groups: ExperimentDto['groups'] }> = ({ groups }) => {
  if (!groups?.length) return null;
  const data = groups.map((g) => ({
    name: g.name,
    value: Math.round(g.trafficRatio * 100),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
          label={({ name, value }) => `${name}: ${value}%`}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <RTooltip formatter={((value: number) => `${value}%`) as any} />
      </PieChart>
    </ResponsiveContainer>
  );
};

// ==================== 指标对比图 ====================

const MetricsCompareChart: React.FC<{ metrics: ExperimentMetric[] }> = ({ metrics }) => {
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
        <RTooltip formatter={((value: number) => `${value}%`) as any} />
        <Legend />
        <ReferenceLine y={50} stroke="#52c41a" strokeDasharray="5 5" label="目标线" />
        <Bar dataKey="接受率" fill="#52c41a" />
        <Bar dataKey="替换率" fill="#faad14" />
        <Bar dataKey="跳过率" fill="#f5222d" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// ==================== 多维雷达对比 ====================

const MetricsRadarChart: React.FC<{ metrics: ExperimentMetric[] }> = ({ metrics }) => {
  if (!metrics?.length || metrics.length < 2) return null;

  // 归一化各维度到 0-100
  const maxSample = Math.max(...metrics.map((m) => m.sampleSize), 1);
  const maxRec = Math.max(...metrics.map((m) => m.totalRecommendations), 1);
  const maxScore = Math.max(...metrics.map((m) => m.avgNutritionScore), 1);

  const dimensions = [
    { key: '接受率', getter: (m: ExperimentMetric) => m.acceptanceRate * 100 },
    { key: '样本量', getter: (m: ExperimentMetric) => (m.sampleSize / maxSample) * 100 },
    { key: '推荐量', getter: (m: ExperimentMetric) => (m.totalRecommendations / maxRec) * 100 },
    { key: '营养评分', getter: (m: ExperimentMetric) => (m.avgNutritionScore / maxScore) * 100 },
    {
      key: '互动率',
      getter: (m: ExperimentMetric) =>
        m.totalRecommendations > 0
          ? ((m.acceptedCount + m.replacedCount) / m.totalRecommendations) * 100
          : 0,
    },
  ];

  const radarData = dimensions.map((dim) => {
    const entry: Record<string, string | number> = { dimension: dim.key };
    metrics.forEach((m) => {
      entry[m.groupId] = Math.round(dim.getter(m) * 10) / 10;
    });
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={radarData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dimension" />
        <PolarRadiusAxis domain={[0, 100]} />
        {metrics.map((m, i) => (
          <Radar
            key={m.groupId}
            name={m.groupId}
            dataKey={m.groupId}
            stroke={COLORS[i % COLORS.length]}
            fill={COLORS[i % COLORS.length]}
            fillOpacity={0.15}
          />
        ))}
        <Legend />
        <RTooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
};

// ==================== 分析报告组件 ====================

const AnalysisReport: React.FC<{
  analysis: ExperimentAnalysis;
  onPromoteWinner?: (winnerGroup: string) => void;
}> = ({ analysis, onPromoteWinner }) => {
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

      {/* 获胜组 + 推广按钮 */}
      {analysis.winner && (
        <Card size="small">
          <Result
            icon={<TrophyOutlined style={{ color: '#faad14' }} />}
            title={`获胜组: ${analysis.winner}`}
            subTitle={analysis.conclusion}
            status="info"
            extra={
              onPromoteWinner && (
                <Tooltip title="将获胜组的配置推广为正式策略">
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    onClick={() => onPromoteWinner(analysis.winner!)}
                  >
                    推广获胜策略
                  </Button>
                </Tooltip>
              )
            }
          />
        </Card>
      )}

      {/* 两两比较 */}
      {analysis.comparisons.length > 0 && (
        <Card title="统计显著性比较 (卡方检验)" size="small">
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
                render: (_, r) => {
                  const p = r.significance.pValue;
                  return (
                    <Text type={p < 0.05 ? 'success' : p < 0.1 ? 'warning' : undefined}>
                      {p.toFixed(4)}
                      {p < 0.01 && ' ***'}
                      {p >= 0.01 && p < 0.05 && ' **'}
                      {p >= 0.05 && p < 0.1 && ' *'}
                    </Text>
                  );
                },
              },
              {
                title: '自由度',
                key: 'df',
                width: 80,
                render: (_, r) => r.significance.df,
              },
              {
                title: '接受率提升',
                key: 'lift',
                width: 130,
                render: (_, r) => (
                  <Space>
                    <Text type={r.acceptanceRateLift > 0 ? 'success' : 'danger'}>
                      {r.acceptanceRateLift > 0 ? '+' : ''}
                      {r.acceptanceRateLift}%
                    </Text>
                    <Progress
                      percent={Math.min(Math.abs(r.acceptanceRateLift), 100)}
                      size="small"
                      showInfo={false}
                      strokeColor={r.acceptanceRateLift > 0 ? '#52c41a' : '#f5222d'}
                      style={{ width: 50 }}
                    />
                  </Space>
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
  const [editGroups, setEditGroups] = useState<
    { name: string; trafficRatio: number; scoreWeightOverrides?: any; mealWeightOverrides?: any }[]
  >([]);

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

  // 推广获胜策略：跳转到策略创建页，预填获胜组的配置
  const handlePromoteWinner = (winnerGroup: string) => {
    if (!experiment) return;
    const group = experiment.groups?.find((g) => g.name === winnerGroup);
    if (!group) {
      message.warning('未找到获胜组配置');
      return;
    }
    // 将获胜组配置编码为查询参数，策略创建页面可读取
    const params = new URLSearchParams({
      fromExperiment: experiment.id,
      experimentName: experiment.name,
      winnerGroup: winnerGroup,
      goalType: experiment.goalType,
    });
    if (group.scoreWeightOverrides) {
      params.set('scoreWeights', JSON.stringify(group.scoreWeightOverrides));
    }
    if (group.mealWeightOverrides) {
      params.set('mealWeights', JSON.stringify(group.mealWeightOverrides));
    }
    navigate(`/recommendation/strategy/create?${params.toString()}`);
    message.info('已跳转到策略创建页面，已预填获胜组配置');
  };

  // 复制实验
  const handleCloneExperiment = () => {
    if (!experiment) return;
    const params = new URLSearchParams({
      cloneFrom: experiment.id,
      name: `${experiment.name} (副本)`,
      goalType: experiment.goalType,
      groups: JSON.stringify(experiment.groups),
    });
    navigate(`/recommendation/experiments/list?${params.toString()}`);
  };

  // 实验持续时间
  const experimentDuration = useMemo(() => {
    if (!experiment?.startDate) return null;
    const start = new Date(experiment.startDate);
    const end = experiment.endDate ? new Date(experiment.endDate) : new Date();
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days;
  }, [experiment]);

  // 总样本量
  const totalSampleSize = useMemo(() => {
    if (!metricsData?.metrics) return 0;
    return metricsData.metrics.reduce((sum, m) => sum + m.sampleSize, 0);
  }, [metricsData]);

  // 总推荐数
  const totalRecommendations = useMemo(() => {
    if (!metricsData?.metrics) return 0;
    return metricsData.metrics.reduce((sum, m) => sum + m.totalRecommendations, 0);
  }, [metricsData]);

  // 最佳接受率组
  const bestAcceptanceGroup = useMemo(() => {
    if (!metricsData?.metrics?.length) return null;
    return metricsData.metrics.reduce((best, m) =>
      m.acceptanceRate > best.acceptanceRate ? m : best
    );
  }, [metricsData]);

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!experiment) return <Alert message="实验不存在" type="error" showIcon />;

  const cfg = statusConfig[experiment.status];

  // 编辑弹窗打开
  const openEdit = () => {
    editForm.setFieldsValue({
      name: experiment.name,
      description: experiment.description,
      goalType: experiment.goalType,
    });
    setEditGroups(
      (experiment.groups || []).map((g: any) => ({
        name: g.name || '',
        trafficRatio: g.trafficRatio ?? 0.5,
        scoreWeightOverrides: g.scoreWeightOverrides,
        mealWeightOverrides: g.mealWeightOverrides,
      }))
    );
    setEditModalVisible(true);
  };

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields();
      // 校验 trafficRatio 之和
      const totalRatio = editGroups.reduce((s, g) => s + g.trafficRatio, 0);
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        message.error(`流量分配之和必须为 1.0（当前: ${totalRatio.toFixed(2)}）`);
        return;
      }
      if (editGroups.some((g) => !g.name.trim())) {
        message.error('分组名称不能为空');
        return;
      }
      const dto: UpdateExperimentDto = {
        name: values.name,
        description: values.description,
        goalType: values.goalType,
        groups: editGroups.map((g) => ({
          name: g.name,
          trafficRatio: g.trafficRatio,
          ...(g.scoreWeightOverrides ? { scoreWeightOverrides: g.scoreWeightOverrides } : {}),
          ...(g.mealWeightOverrides ? { mealWeightOverrides: g.mealWeightOverrides } : {}),
        })),
      };
      updateMutation.mutate({ id: id!, data: dto });
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('表单校验失败');
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* 头部操作 */}
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/recommendation/experiments/list')}>
            返回列表
          </Button>
          {(experiment.status === 'draft' || experiment.status === 'paused') && (
            <Button icon={<EditOutlined />} onClick={openEdit}>
              编辑
            </Button>
          )}
          <Tooltip title="以此实验为模板创建新实验">
            <Button icon={<CopyOutlined />} onClick={handleCloneExperiment}>
              复制
            </Button>
          </Tooltip>
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
          {/* 运行中也可直接完成 */}
          {experiment.status === 'running' && (
            <Popconfirm
              title="直接结束实验？"
              description="结束后将标记为完成，确认？"
              onConfirm={() => statusMutation.mutate({ id: id!, status: 'completed' })}
            >
              <Button danger icon={<CheckCircleOutlined />}>
                完成
              </Button>
            </Popconfirm>
          )}
        </Space>

        <Descriptions bordered column={{ xs: 1, sm: 2, md: 2, lg: 2 }}>
          <Descriptions.Item label="实验名称" span={2}>
            <Text strong style={{ fontSize: 16 }}>
              {experiment.name}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="实验 ID">
            <Text copyable style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {experiment.id}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={cfg.color}>{cfg.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="目标类型">
            <Tag color={experiment.goalType === '*' ? 'blue' : 'green'}>
              {experiment.goalType === '*' ? '全部' : experiment.goalType}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="分组数">
            <Tag icon={<TeamOutlined />}>{experiment.groups?.length || 0} 组</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {experiment.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="开始时间">{experiment.startDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="结束时间">{experiment.endDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{experiment.createdAt}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{experiment.updatedAt}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 核心指标概览（非草稿状态显示） */}
      {experiment.status !== 'draft' && (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless">
              <Statistic
                title="总样本量"
                value={totalSampleSize}
                prefix={<TeamOutlined style={{ color: '#1677ff' }} />}
                loading={metricsLoading}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless">
              <Statistic
                title="总推荐数"
                value={totalRecommendations}
                prefix={<SendOutlined style={{ color: '#722ed1' }} />}
                loading={metricsLoading}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless">
              <Statistic
                title="最佳接受率"
                value={
                  bestAcceptanceGroup ? (bestAcceptanceGroup.acceptanceRate * 100).toFixed(1) : '-'
                }
                suffix={bestAcceptanceGroup ? '%' : ''}
                prefix={<TrophyOutlined style={{ color: '#faad14' }} />}
                valueStyle={{ color: '#52c41a' }}
                loading={metricsLoading}
              />
              {bestAcceptanceGroup && (
                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                  {bestAcceptanceGroup.groupId}
                </div>
              )}
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless">
              <Statistic
                title="实验时长"
                value={experimentDuration ?? '-'}
                suffix={experimentDuration ? '天' : ''}
                prefix={<ExperimentOutlined style={{ color: '#13c2c2' }} />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 分组配置 + 流量分配 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
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
                  render: (name: string, _, i) => (
                    <Tag color={COLORS[i % COLORS.length]}>{name}</Tag>
                  ),
                },
                {
                  title: '流量占比',
                  dataIndex: 'trafficRatio',
                  width: 150,
                  render: (ratio: number) => (
                    <Space>
                      <Progress
                        percent={Math.round(ratio * 100)}
                        size="small"
                        style={{ width: 80 }}
                      />
                    </Space>
                  ),
                },
                {
                  title: '评分权重覆盖',
                  dataIndex: 'scoreWeightOverrides',
                  render: (val: Record<string, number[]> | null) =>
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
                  render: (val: Record<string, Record<string, number>> | null) =>
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
        </Col>
        <Col xs={24} lg={8}>
          <Card title="流量分配" size="small">
            <TrafficPieChart groups={experiment.groups} />
          </Card>
        </Col>
      </Row>

      {/* Tabs: 指标 / 雷达图 / 分析报告 / 原始 JSON */}
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
                  {/* 分组指标卡片 */}
                  {metricsData?.metrics && metricsData.metrics.length > 0 && (
                    <Row gutter={[16, 16]}>
                      {metricsData.metrics.map((m, i) => {
                        const isBest = bestAcceptanceGroup?.groupId === m.groupId;
                        return (
                          <Col
                            span={Math.max(6, Math.floor(24 / metricsData.metrics.length))}
                            key={m.groupId}
                          >
                            <Card
                              size="small"
                              title={
                                <Space>
                                  <Tag color={COLORS[i % COLORS.length]}>{m.groupId}</Tag>
                                  {isBest && (
                                    <Tag color="gold" icon={<TrophyOutlined />}>
                                      领先
                                    </Tag>
                                  )}
                                </Space>
                              }
                              style={
                                isBest ? { borderColor: '#faad14', borderWidth: 2 } : undefined
                              }
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
                        );
                      })}
                    </Row>
                  )}

                  {/* 图表并排：柱状图 + 雷达图 */}
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={14}>
                      <Card title="分组指标对比" size="small">
                        <MetricsCompareChart metrics={metricsData?.metrics || []} />
                      </Card>
                    </Col>
                    <Col xs={24} lg={10}>
                      <Card title="多维能力雷达" size="small">
                        {metricsData?.metrics && metricsData.metrics.length >= 2 ? (
                          <MetricsRadarChart metrics={metricsData.metrics} />
                        ) : (
                          <Alert
                            message="至少需要 2 个分组数据才能展示雷达图"
                            type="info"
                            showIcon
                          />
                        )}
                      </Card>
                    </Col>
                  </Row>

                  {/* 指标明细表 */}
                  {metricsData?.metrics && (
                    <Card title="指标明细" size="small">
                      <Table
                        dataSource={metricsData.metrics}
                        rowKey="groupId"
                        pagination={false}
                        size="small"
                        columns={[
                          {
                            title: '分组',
                            dataIndex: 'groupId',
                            width: 120,
                            render: (text: string, _, i) => (
                              <Tag color={COLORS[i % COLORS.length]}>{text}</Tag>
                            ),
                          },
                          { title: '样本量', dataIndex: 'sampleSize', width: 80 },
                          { title: '总推荐', dataIndex: 'totalRecommendations', width: 80 },
                          { title: '接受', dataIndex: 'acceptedCount', width: 80 },
                          { title: '替换', dataIndex: 'replacedCount', width: 80 },
                          { title: '跳过', dataIndex: 'skippedCount', width: 80 },
                          {
                            title: '接受率',
                            key: 'rate',
                            width: 100,
                            sorter: (a, b) => a.acceptanceRate - b.acceptanceRate,
                            render: (_, r) => (
                              <Text type="success">{(r.acceptanceRate * 100).toFixed(2)}%</Text>
                            ),
                          },
                          {
                            title: '平均评分',
                            dataIndex: 'avgNutritionScore',
                            width: 100,
                            sorter: (a, b) => a.avgNutritionScore - b.avgNutritionScore,
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
                <AnalysisReport
                  analysis={analysis}
                  onPromoteWinner={
                    analysis.canConclude && analysis.winner ? handlePromoteWinner : undefined
                  }
                />
              ) : (
                <Alert message="暂无分析数据" type="info" showIcon />
              ),
            },
            {
              key: 'json',
              label: '原始 JSON',
              children: (
                <Tabs
                  type="card"
                  items={[
                    {
                      key: 'experiment',
                      label: '实验配置',
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
                    {
                      key: 'metrics-json',
                      label: '指标数据',
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
                          {JSON.stringify(metricsData, null, 2)}
                        </pre>
                      ),
                    },
                    {
                      key: 'analysis-json',
                      label: '分析报告',
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
                          {JSON.stringify(analysis, null, 2)}
                        </pre>
                      ),
                    },
                  ]}
                />
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
        width={720}
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
          <Divider>分组配置</Divider>
          <div style={{ marginBottom: 8 }}>
            <Row justify="space-between" align="middle">
              <Text type="secondary">
                流量分配总和:{' '}
                <Text
                  strong
                  type={
                    Math.abs(editGroups.reduce((s, g) => s + g.trafficRatio, 0) - 1.0) <= 0.01
                      ? 'success'
                      : 'danger'
                  }
                >
                  {editGroups.reduce((s, g) => s + g.trafficRatio, 0).toFixed(2)}
                </Text>{' '}
                / 1.00
              </Text>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  setEditGroups([
                    ...editGroups,
                    {
                      name: `variant_${String.fromCharCode(97 + editGroups.length)}`,
                      trafficRatio: 0,
                    },
                  ])
                }
              >
                添加分组
              </Button>
            </Row>
          </div>
          {editGroups.map((group, index) => (
            <Card
              key={index}
              size="small"
              style={{ marginBottom: 8 }}
              title={
                <Space>
                  <Tag color={index === 0 ? 'blue' : 'green'}>
                    {index === 0 ? '对照组' : `实验组 ${index}`}
                  </Tag>
                  <Input
                    size="small"
                    value={group.name}
                    onChange={(e) => {
                      const newGroups = [...editGroups];
                      newGroups[index] = { ...newGroups[index], name: e.target.value };
                      setEditGroups(newGroups);
                    }}
                    style={{ width: 150 }}
                    placeholder="分组名称"
                  />
                </Space>
              }
              extra={
                editGroups.length > 2 ? (
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      const newGroups = editGroups.filter((_, i) => i !== index);
                      setEditGroups(newGroups);
                    }}
                  />
                ) : null
              }
            >
              <Row gutter={16} align="middle">
                <Col span={4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    流量比例
                  </Text>
                </Col>
                <Col span={14}>
                  <Slider
                    min={0}
                    max={100}
                    value={Math.round(group.trafficRatio * 100)}
                    onChange={(v) => {
                      const newGroups = [...editGroups];
                      newGroups[index] = { ...newGroups[index], trafficRatio: v / 100 };
                      setEditGroups(newGroups);
                    }}
                    marks={{ 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '100%' }}
                  />
                </Col>
                <Col span={6}>
                  <InputNumber
                    size="small"
                    min={0}
                    max={100}
                    value={Math.round(group.trafficRatio * 100)}
                    onChange={(v) => {
                      const newGroups = [...editGroups];
                      newGroups[index] = { ...newGroups[index], trafficRatio: (v ?? 0) / 100 };
                      setEditGroups(newGroups);
                    }}
                    formatter={(v) => `${v}%`}
                    parser={(v) => Number(v?.replace('%', '') || 0) as any}
                    style={{ width: '100%' }}
                  />
                </Col>
              </Row>
            </Card>
          ))}
        </Form>
      </Modal>
    </Space>
  );
};

export default ABExperimentDetail;
