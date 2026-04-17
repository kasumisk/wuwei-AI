import React, { useState, useMemo } from 'react';
import {
  Card,
  Form,
  Select,
  InputNumber,
  Button,
  Row,
  Col,
  Tag,
  Space,
  Typography,
  Statistic,
  Alert,
  Empty,
  Table,
  Divider,
  Progress,
  Tooltip,
  Badge,
} from 'antd';
import {
  DashboardOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  DatabaseOutlined,
  FundOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  usePipelineStats,
  type PipelineStatsResult,
  type PipelineStatsQueryDto,
  type PipelineStageStats,
} from '@/services/recommendDebugService';

const { Text } = Typography;

export const routeConfig = {
  name: 'recommend-pipeline-stats',
  title: 'Pipeline 统计',
  icon: 'DashboardOutlined',
  order: 9,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const mealTypeOptions = [
  { label: '全部餐次', value: '' },
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
];

const daysOptions = [
  { label: '最近 1 天', value: 1 },
  { label: '最近 3 天', value: 3 },
  { label: '最近 7 天', value: 7 },
  { label: '最近 14 天', value: 14 },
  { label: '最近 30 天', value: 30 },
];

const stageLabels: Record<string, { label: string; color: string }> = {
  recall: { label: '召回', color: '#1677ff' },
  realistic_filter: { label: '现实性过滤', color: '#722ed1' },
  rank: { label: '排序', color: '#13c2c2' },
  health_modifier: { label: '健康修正', color: '#52c41a' },
  scoring_chain: { label: '评分链', color: '#faad14' },
  rerank: { label: '重排序', color: '#eb2f96' },
  assemble: { label: '组装', color: '#fa541c' },
};

const PIE_COLORS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#ff4d4f',
  '#722ed1',
  '#13c2c2',
  '#fa541c',
  '#eb2f96',
  '#2f54eb',
  '#a0d911',
];

// ==================== 工具函数 ====================

const durationColor = (ms: number): string => {
  if (ms <= 50) return '#52c41a';
  if (ms <= 100) return '#1677ff';
  if (ms <= 200) return '#faad14';
  return '#ff4d4f';
};

const rateColor = (rate: number): string => {
  if (rate >= 80) return '#52c41a';
  if (rate >= 50) return '#1677ff';
  if (rate >= 20) return '#faad14';
  return '#ff4d4f';
};

// ==================== 阶段耗时柱状图 ====================

const StagePerformanceChart: React.FC<{
  stageStats: Record<string, PipelineStageStats>;
}> = ({ stageStats }) => {
  const barData = Object.entries(stageStats)
    .map(([stage, stats]) => ({
      stage: stageLabels[stage]?.label || stage,
      avgDurationMs: parseFloat(stats.avgDurationMs.toFixed(1)),
      avgOutputCount: Math.round(stats.avgOutputCount),
      sampleCount: stats.sampleCount,
      color: stageLabels[stage]?.color || '#999',
      key: stage,
    }))
    .sort((a, b) => {
      const order = Object.keys(stageLabels);
      return order.indexOf(a.key) - order.indexOf(b.key);
    });

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={barData} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
          <YAxis
            yAxisId="right"
            orientation="right"
            label={{ value: '候选数', angle: 90, position: 'insideRight' }}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.stage}</div>
                  <div>
                    平均耗时: <span style={{ color: d.color }}>{d.avgDurationMs}ms</span>
                  </div>
                  <div>平均输出候选: {d.avgOutputCount} 个</div>
                  <div>采样数: {d.sampleCount}</div>
                </div>
              );
            }}
          />
          <Legend />
          <Bar yAxisId="left" dataKey="avgDurationMs" name="平均耗时(ms)" radius={[4, 4, 0, 0]}>
            {barData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
          <Bar
            yAxisId="right"
            dataKey="avgOutputCount"
            name="平均输出候选"
            fill="#d9d9d9"
            radius={[4, 4, 0, 0]}
            opacity={0.5}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ==================== 场景/餐次分布饼图 ====================

const DistributionPieChart: React.FC<{
  data: Record<string, number>;
  title: string;
}> = ({ data, title }) => {
  if (!data || Object.keys(data).length === 0) {
    return <Empty description={`暂无${title}数据`} />;
  }

  const pieData = Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const total = pieData.reduce((s, d) => s + d.value, 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={90}
            innerRadius={45}
            label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
            labelLine={{ length: 15, length2: 8 }}
          >
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <RechartsTooltip
            formatter={(value: number, name: string) => [
              `${value} 次 (${((value / total) * 100).toFixed(1)}%)`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

// ==================== 阶段详情表格 ====================

const StageDetailTable: React.FC<{
  stageStats: Record<string, PipelineStageStats>;
}> = ({ stageStats }) => {
  const dataSource = Object.entries(stageStats).map(([stage, stats]) => ({
    key: stage,
    stage: stageLabels[stage]?.label || stage,
    color: stageLabels[stage]?.color || '#999',
    ...stats,
  }));

  // Sort by pipeline order
  const stageOrder = Object.keys(stageLabels);
  dataSource.sort((a, b) => stageOrder.indexOf(a.key) - stageOrder.indexOf(b.key));

  const totalAvgDuration = dataSource.reduce((s, d) => s + d.avgDurationMs, 0);

  const columns: ColumnsType<(typeof dataSource)[0]> = [
    {
      title: '阶段',
      dataIndex: 'stage',
      key: 'stage',
      width: 120,
      render: (name: string, record) => (
        <Space>
          <Badge color={record.color} />
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    {
      title: '平均耗时',
      dataIndex: 'avgDurationMs',
      key: 'avgDurationMs',
      width: 120,
      sorter: (a, b) => a.avgDurationMs - b.avgDurationMs,
      render: (ms: number) => (
        <Text strong style={{ color: durationColor(ms) }}>
          {ms.toFixed(1)}ms
        </Text>
      ),
    },
    {
      title: '耗时占比',
      key: 'durationPct',
      width: 150,
      render: (_, record) => {
        const pct = totalAvgDuration > 0 ? (record.avgDurationMs / totalAvgDuration) * 100 : 0;
        return (
          <Progress
            percent={Math.round(pct)}
            size="small"
            strokeColor={record.color}
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: '平均输出候选',
      dataIndex: 'avgOutputCount',
      key: 'avgOutputCount',
      width: 120,
      sorter: (a, b) => a.avgOutputCount - b.avgOutputCount,
      render: (count: number) => <Text>{Math.round(count)} 个</Text>,
    },
    {
      title: '采样数',
      dataIndex: 'sampleCount',
      key: 'sampleCount',
      width: 100,
      sorter: (a, b) => a.sampleCount - b.sampleCount,
      render: (count: number) => <Tag>{count}</Tag>,
    },
  ];

  return (
    <Table
      dataSource={dataSource}
      columns={columns}
      size="small"
      pagination={false}
      summary={(data) => {
        const totalSamples = Math.max(...data.map((d) => d.sampleCount), 0);
        return (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <Text strong>合计</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1}>
              <Text strong style={{ color: durationColor(totalAvgDuration) }}>
                {totalAvgDuration.toFixed(1)}ms
              </Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2}>
              <Text>100%</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              <Text>-</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4}>
              <Text>{totalSamples}</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        );
      }}
    />
  );
};

// ==================== 主组件 ====================

const PipelineStatsPage: React.FC = () => {
  const [query, setQuery] = useState<PipelineStatsQueryDto>({ days: 7 });

  const { data, isLoading, isError, error, refetch } = usePipelineStats(query);

  const handleQueryChange = (field: string, value: any) => {
    setQuery((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  return (
    <div>
      {/* 查询筛选 */}
      <Card
        title={
          <Space>
            <DashboardOutlined />
            <span>Pipeline 统计</span>
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="查看推荐 Pipeline 各阶段的性能统计：耗时分布、候选流量、缓存命中率、降级率"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Row gutter={16}>
          <Col xs={12} sm={8} md={6}>
            <Form.Item label="时间范围" style={{ marginBottom: 0 }}>
              <Select
                value={query.days || 7}
                options={daysOptions}
                onChange={(v) => handleQueryChange('days', v)}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Form.Item label="餐次类型" style={{ marginBottom: 0 }}>
              <Select
                value={query.mealType || ''}
                options={mealTypeOptions}
                onChange={(v) => handleQueryChange('mealType', v)}
                style={{ width: '100%' }}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Form.Item label="场景名称" style={{ marginBottom: 0 }}>
              <Select
                value={query.sceneName || undefined}
                placeholder="全部场景"
                onChange={(v) => handleQueryChange('sceneName', v)}
                style={{ width: '100%' }}
                allowClear
                mode={undefined}
                showSearch
                options={[
                  { label: '标准推荐', value: 'standard' },
                  { label: '快速推荐', value: 'quick' },
                  { label: '详细推荐', value: 'detailed' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      {/* 错误提示 */}
      {isError && (
        <Alert
          type="error"
          showIcon
          message="加载 Pipeline 统计失败"
          description={(error as Error)?.message || '请稍后重试'}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => refetch()}>
              重试
            </Button>
          }
        />
      )}

      {/* 数据为空或消息提示 */}
      {data?.message && (
        <Alert type="warning" showIcon message={data.message} style={{ marginBottom: 16 }} />
      )}

      {data && !data.message && (
        <>
          {/* 概览指标 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="追踪总数"
                  value={data.traceCount}
                  prefix={<DatabaseOutlined />}
                  suffix={`(${data.days}天)`}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="平均总耗时"
                  value={data.avgTotalDurationMs?.toFixed(1) ?? '-'}
                  suffix="ms"
                  valueStyle={{ color: durationColor(data.avgTotalDurationMs ?? 0) }}
                  prefix={<ClockCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="缓存命中率"
                  value={data.cacheHitRate != null ? (data.cacheHitRate * 100).toFixed(1) : '-'}
                  suffix="%"
                  valueStyle={{
                    color: rateColor((data.cacheHitRate ?? 0) * 100),
                  }}
                  prefix={<ThunderboltOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="降级率"
                  value={
                    data.degradationRate != null ? (data.degradationRate * 100).toFixed(1) : '-'
                  }
                  suffix="%"
                  valueStyle={{
                    color:
                      data.degradationRate != null && data.degradationRate > 0.1
                        ? '#ff4d4f'
                        : '#52c41a',
                  }}
                  prefix={<WarningOutlined />}
                />
              </Card>
            </Col>
          </Row>

          {/* 阶段耗时柱状图 */}
          {data.stageStats && Object.keys(data.stageStats).length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  <FundOutlined />
                  <span>各阶段性能</span>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <StagePerformanceChart stageStats={data.stageStats} />
              <Divider style={{ margin: '12px 0' }}>阶段详细数据</Divider>
              <StageDetailTable stageStats={data.stageStats} />
            </Card>
          )}

          {/* 场景/餐次分布 */}
          <Row gutter={[16, 16]}>
            {data.mealTypeCounts && Object.keys(data.mealTypeCounts).length > 0 && (
              <Col xs={24} md={12}>
                <Card
                  size="small"
                  title={
                    <Space>
                      <PieChartOutlined />
                      <span>餐次分布</span>
                    </Space>
                  }
                >
                  <DistributionPieChart data={data.mealTypeCounts} title="餐次" />
                </Card>
              </Col>
            )}
            {data.sceneCounts && Object.keys(data.sceneCounts).length > 0 && (
              <Col xs={24} md={12}>
                <Card
                  size="small"
                  title={
                    <Space>
                      <PieChartOutlined />
                      <span>场景分布</span>
                    </Space>
                  }
                >
                  <DistributionPieChart data={data.sceneCounts} title="场景" />
                </Card>
              </Col>
            )}
          </Row>
        </>
      )}

      {/* 空状态 */}
      {!isLoading && !data && !isError && (
        <Card>
          <Empty description="暂无 Pipeline 统计数据" />
        </Card>
      )}
    </div>
  );
};

export default PipelineStatsPage;
