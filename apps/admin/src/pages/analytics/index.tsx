import React, { useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  DatePicker,
  Select,
  Statistic,
  Table,
  Tag,
  Space,
  Spin,
  Empty,
  Tabs,
  Progress,
  Tooltip,
  Typography,
} from 'antd';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  TeamOutlined,
  FileTextOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  BugOutlined,
  FundOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  useDashboard,
  useTimeSeries,
  useCostAnalysis,
  useErrorAnalysis,
  useTopClients,
  useCapabilityUsage,
  getPresetDateRange,
} from '../../services/analyticsService';
import type {
  TopClientDto,
  CapabilityUsageDto,
  ErrorTypeDto,
  TimeInterval,
  GroupBy,
  CostAnalysisItemDto,
  DashboardStatsDto,
} from '@ai-platform/shared';

const { RangePicker } = DatePicker;
const { Text } = Typography;

// 图表配色
const COLORS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#ff4d4f',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
];

// ==================== 概览 Tab ====================

const OverviewTab: React.FC<{
  dashboard: DashboardStatsDto | undefined;
  loading: boolean;
  dateRange: [Dayjs, Dayjs];
}> = ({ dashboard, loading, dateRange }) => {
  const [timeInterval, setTimeInterval] = useState<TimeInterval>('day' as TimeInterval);
  const [timeMetric, setTimeMetric] = useState<'requests' | 'cost' | 'tokens' | 'responseTime'>(
    'requests'
  );

  const { data: tsData, isLoading: tsLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: timeInterval,
    metric: timeMetric,
  });

  const overview = dashboard?.overview;

  // 客户端排行表格列
  const clientColumns: ColumnsType<TopClientDto> = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_: unknown, __: unknown, i: number) => i + 1,
    },
    { title: '客户端', dataIndex: 'clientName', key: 'clientName' },
    {
      title: '请求数',
      dataIndex: 'requestCount',
      key: 'requestCount',
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (r: number) => (
        <Tag color={r >= 95 ? 'success' : r >= 90 ? 'warning' : 'error'}>{r?.toFixed(2)}%</Tag>
      ),
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      render: (c: number) => `$${c?.toFixed(4) ?? '0'}`,
    },
  ];

  // 能力使用表格列
  const capColumns: ColumnsType<CapabilityUsageDto> = [
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      key: 'capabilityType',
      render: (t: string) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: '请求数',
      dataIndex: 'requestCount',
      key: 'requestCount',
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (r: number) => (
        <Tag color={r >= 95 ? 'success' : r >= 90 ? 'warning' : 'error'}>{r?.toFixed(2)}%</Tag>
      ),
    },
    {
      title: '平均延迟',
      dataIndex: 'avgResponseTime',
      key: 'avgResponseTime',
      render: (t: number) => `${t?.toFixed(0) ?? '-'}ms`,
    },
    {
      title: '总 Tokens',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (t: number) => t?.toLocaleString() ?? '-',
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      render: (c: number) => `$${c?.toFixed(4) ?? '0'}`,
    },
  ];

  const metricLabel: Record<string, string> = {
    requests: '请求数',
    cost: '成本 ($)',
    tokens: 'Tokens',
    responseTime: '响应时间 (ms)',
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 概览统计卡片 */}
      <Row gutter={[16, 16]}>
        {[
          {
            title: '总请求数',
            value: overview?.totalRequests ?? 0,
            icon: <ApiOutlined />,
            color: '#1677ff',
          },
          {
            title: '成功率',
            value: overview?.successRate ?? 0,
            suffix: '%',
            precision: 2,
            icon: <CheckCircleOutlined />,
            color: (overview?.successRate ?? 0) >= 95 ? '#52c41a' : '#ff4d4f',
          },
          {
            title: '平均延迟',
            value: overview?.avgResponseTime ?? 0,
            suffix: 'ms',
            precision: 0,
            icon: <ClockCircleOutlined />,
            color: '#faad14',
          },
          {
            title: '总成本',
            value: overview?.totalCost ?? 0,
            prefix: '$',
            precision: 4,
            icon: <DollarOutlined />,
            color: '#722ed1',
          },
          {
            title: '总 Tokens',
            value: overview?.totalTokens ?? 0,
            icon: <FileTextOutlined />,
            color: '#13c2c2',
          },
          {
            title: '活跃客户',
            value: overview?.uniqueClients ?? 0,
            icon: <TeamOutlined />,
            color: '#eb2f96',
          },
        ].map((item) => (
          <Col key={item.title} xs={12} sm={8} md={4}>
            <Card size="small" variant="borderless" loading={loading}>
              <Statistic
                title={item.title}
                value={item.value}
                prefix={
                  item.prefix ? item.prefix : <span style={{ color: item.color }}>{item.icon}</span>
                }
                suffix={item.suffix}
                precision={item.precision}
                valueStyle={{ color: item.color }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 时间序列趋势图 */}
      <Card
        title="趋势分析"
        extra={
          <Space>
            <Select
              size="small"
              style={{ width: 100 }}
              value={timeInterval}
              onChange={setTimeInterval}
              options={[
                { label: '按小时', value: 'hour' },
                { label: '按天', value: 'day' },
                { label: '按周', value: 'week' },
                { label: '按月', value: 'month' },
              ]}
            />
            <Select
              size="small"
              style={{ width: 110 }}
              value={timeMetric}
              onChange={setTimeMetric}
              options={[
                { label: '请求数', value: 'requests' },
                { label: '成本', value: 'cost' },
                { label: 'Tokens', value: 'tokens' },
                { label: '响应时间', value: 'responseTime' },
              ]}
            />
          </Space>
        }
      >
        {tsLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : tsData?.data && tsData.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={tsData.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartsTooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#1677ff"
                strokeWidth={2}
                dot={false}
                name={metricLabel[timeMetric]}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>

      {/* 客户端排行 + 能力使用 */}
      <Row gutter={16}>
        <Col span={12}>
          <Card title="Top 客户端" loading={loading}>
            <Table
              columns={clientColumns}
              dataSource={dashboard?.topClients ?? []}
              rowKey="clientId"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="能力使用统计" loading={loading}>
            <Table
              columns={capColumns}
              dataSource={dashboard?.capabilityUsage ?? []}
              rowKey="capabilityType"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
};

// ==================== 成本分析 Tab ====================

const CostAnalysisTab: React.FC<{ dateRange: [Dayjs, Dayjs] }> = ({ dateRange }) => {
  const [groupBy, setGroupBy] = useState<GroupBy>('capability' as GroupBy);

  const { data: costData, isLoading } = useCostAnalysis({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    groupBy,
  });

  const { data: costTrend, isLoading: trendLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: 'day' as TimeInterval,
    metric: 'cost',
  });

  const { data: topClients, isLoading: clientsLoading } = useTopClients({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    limit: 10,
  });

  const costColumns: ColumnsType<CostAnalysisItemDto> = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '成本',
      dataIndex: 'cost',
      key: 'cost',
      sorter: (a, b) => a.cost - b.cost,
      render: (c: number) => <Text strong>${c?.toFixed(4)}</Text>,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (p: number) => (
        <Progress
          percent={Number(p?.toFixed(1)) || 0}
          size="small"
          strokeColor="#722ed1"
          style={{ width: 120 }}
        />
      ),
    },
    {
      title: '请求数',
      dataIndex: 'requests',
      key: 'requests',
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
    {
      title: 'Tokens',
      dataIndex: 'tokens',
      key: 'tokens',
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 成本总额卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="总成本"
              value={costData?.totalCost ?? 0}
              prefix="$"
              precision={4}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="分组维度"
              value={costData?.items?.length ?? 0}
              suffix={`项 (按${groupBy === 'client' ? '客户端' : groupBy === 'capability' ? '能力' : groupBy === 'provider' ? '提供商' : '模型'})`}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" variant="borderless" loading={clientsLoading}>
            <Statistic
              title="最高消费客户端"
              value={topClients?.clients?.[0]?.clientName ?? '-'}
              suffix={
                topClients?.clients?.[0] ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    ${topClients.clients[0].totalCost?.toFixed(2)}
                  </Text>
                ) : undefined
              }
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 成本分布饼图 */}
        <Col xs={24} lg={10}>
          <Card
            title="成本分布"
            extra={
              <Select
                size="small"
                style={{ width: 100 }}
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { label: '按能力', value: 'capability' },
                  { label: '按客户端', value: 'client' },
                  { label: '按提供商', value: 'provider' },
                  { label: '按模型', value: 'model' },
                ]}
              />
            }
          >
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : costData?.items && costData.items.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={costData.items}
                    dataKey="cost"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    label={
                      ((entry: CostAnalysisItemDto) =>
                        `${entry.name}: $${entry.cost.toFixed(2)}`) as any
                    }
                  >
                    {costData.items.map((_: CostAnalysisItemDto, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={((v: number) => `$${v.toFixed(4)}`) as any} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>

        {/* 成本明细表格 */}
        <Col xs={24} lg={14}>
          <Card title="成本明细">
            <Table
              columns={costColumns}
              dataSource={costData?.items ?? []}
              rowKey="id"
              loading={isLoading}
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>

      {/* 成本趋势折线图 */}
      <Card title="成本趋势（按天）">
        {trendLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : costTrend?.data && costTrend.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={costTrend.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={((v: number) => `$${v.toFixed(4)}`) as any} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#722ed1"
                strokeWidth={2}
                dot={false}
                name="成本 ($)"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>
    </Space>
  );
};

// ==================== 错误分析 Tab ====================

const ErrorAnalysisTab: React.FC<{ dateRange: [Dayjs, Dayjs] }> = ({ dateRange }) => {
  const { data: errorData, isLoading } = useErrorAnalysis({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    limit: 50,
  });

  const { data: reqTrend, isLoading: trendLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: 'day' as TimeInterval,
    metric: 'requests',
  });

  // 错误分布条形图数据
  const barData = useMemo(() => {
    return (errorData?.errors ?? []).slice(0, 10).map((e) => ({
      name: e.errorType.length > 20 ? e.errorType.slice(0, 20) + '...' : e.errorType,
      count: e.count,
      percentage: e.percentage,
    }));
  }, [errorData]);

  const errorColumns: ColumnsType<ErrorTypeDto> = [
    {
      title: '错误类型',
      dataIndex: 'errorType',
      key: 'errorType',
      render: (t: string) => (
        <Tooltip title={t}>
          <Tag color="error">{t.length > 30 ? t.slice(0, 30) + '...' : t}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
      width: 300,
    },
    {
      title: '出现次数',
      dataIndex: 'count',
      key: 'count',
      sorter: (a, b) => a.count - b.count,
      render: (c: number) => <Text strong>{c?.toLocaleString()}</Text>,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (p: number) => (
        <Progress
          percent={Number(p?.toFixed(1)) || 0}
          size="small"
          strokeColor="#ff4d4f"
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '最后出现',
      dataIndex: 'lastOccurrence',
      key: 'lastOccurrence',
      width: 170,
      render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 错误统计卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="错误总数"
              value={errorData?.totalErrors ?? 0}
              prefix={<BugOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="错误类型数"
              value={errorData?.errors?.length ?? 0}
              prefix={<WarningOutlined style={{ color: '#faad14' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="最常见错误"
              value={errorData?.errors?.[0]?.errorType ?? '-'}
              valueStyle={{ fontSize: 14 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 错误分布条形图 */}
        <Col xs={24} lg={12}>
          <Card title="Top 10 错误类型分布">
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={barData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                  <RechartsTooltip />
                  <Bar dataKey="count" fill="#ff4d4f" name="出现次数" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无错误" />
            )}
          </Card>
        </Col>

        {/* 请求趋势（用于对比错误与总流量的关系） */}
        <Col xs={24} lg={12}>
          <Card title="请求量趋势（辅助对比）">
            {trendLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : reqTrend?.data && reqTrend.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={reqTrend.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#1677ff"
                    strokeWidth={2}
                    dot={false}
                    name="请求数"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 错误明细表格 */}
      <Card title="错误明细">
        <Table
          columns={errorColumns}
          dataSource={errorData?.errors ?? []}
          rowKey="errorType"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          size="small"
          scroll={{ x: 900 }}
        />
      </Card>
    </Space>
  );
};

// ==================== 能力使用 Tab ====================

const CapabilityUsageTab: React.FC<{ dateRange: [Dayjs, Dayjs] }> = ({ dateRange }) => {
  const { data: capData, isLoading } = useCapabilityUsage({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
  });

  const { data: tokenTrend, isLoading: trendLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: 'day' as TimeInterval,
    metric: 'tokens',
  });

  const { data: reqTrend, isLoading: reqTrendLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: 'day' as TimeInterval,
    metric: 'requests',
  });

  // 能力使用条形图数据
  const barData = useMemo(() => {
    return (capData?.usage ?? []).map((u) => ({
      name: u.capabilityType,
      requestCount: u.requestCount,
      totalCost: u.totalCost,
      totalTokens: u.totalTokens,
    }));
  }, [capData]);

  const capColumns: ColumnsType<CapabilityUsageDto> = [
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      key: 'capabilityType',
      render: (t: string) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: '请求数',
      dataIndex: 'requestCount',
      key: 'requestCount',
      sorter: (a, b) => a.requestCount - b.requestCount,
      render: (v: number) => <Text strong>{v?.toLocaleString()}</Text>,
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (r: number) => (
        <Tag color={r >= 95 ? 'success' : r >= 90 ? 'warning' : 'error'}>{r?.toFixed(2)}%</Tag>
      ),
    },
    {
      title: '平均延迟',
      dataIndex: 'avgResponseTime',
      key: 'avgResponseTime',
      sorter: (a, b) => a.avgResponseTime - b.avgResponseTime,
      render: (t: number) => {
        const color = t > 5000 ? '#ff4d4f' : t > 2000 ? '#faad14' : '#52c41a';
        return <Text style={{ color }}>{t?.toFixed(0)}ms</Text>;
      },
    },
    {
      title: '总 Tokens',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      sorter: (a, b) => a.totalCost - b.totalCost,
      render: (c: number) => `$${c?.toFixed(4)}`,
    },
  ];

  // 计算汇总数据
  const totalRequests = (capData?.usage ?? []).reduce((s, u) => s + u.requestCount, 0);
  const totalTokens = (capData?.usage ?? []).reduce((s, u) => s + u.totalTokens, 0);
  const totalCost = (capData?.usage ?? []).reduce((s, u) => s + u.totalCost, 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 汇总卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic
              title="能力类型数"
              value={capData?.usage?.length ?? 0}
              prefix={<ThunderboltOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic title="总请求数" value={totalRequests} prefix={<ApiOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic title="总 Tokens" value={totalTokens} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" variant="borderless" loading={isLoading}>
            <Statistic title="总成本" value={totalCost} prefix="$" precision={4} />
          </Card>
        </Col>
      </Row>

      {/* 能力使用分布条形图 */}
      <Card title="各能力请求量分布">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartsTooltip />
              <Legend />
              <Bar dataKey="requestCount" fill="#1677ff" name="请求数" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>

      {/* 趋势图行 */}
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title="Token 消耗趋势">
            {trendLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : tokenTrend?.data && tokenTrend.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={tokenTrend.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#13c2c2"
                    strokeWidth={2}
                    dot={false}
                    name="Tokens"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="请求量趋势">
            {reqTrendLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : reqTrend?.data && reqTrend.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={reqTrend.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#1677ff"
                    strokeWidth={2}
                    dot={false}
                    name="请求数"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 能力明细表格 */}
      <Card title="能力使用明细">
        <Table
          columns={capColumns}
          dataSource={capData?.usage ?? []}
          rowKey="capabilityType"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      </Card>
    </Space>
  );
};

// ==================== 主组件 ====================

const AnalyticsDashboard: React.FC = () => {
  // 日期范围状态
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => {
    const { startDate, endDate } = getPresetDateRange('week');
    return [dayjs(startDate), dayjs(endDate)];
  });

  // 获取仪表盘聚合数据（概览 Tab 用）
  const { data: dashboardData, isLoading: isDashboardLoading } = useDashboard({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
  });

  // 快捷日期选择
  const handlePresetChange = (preset: string) => {
    const { startDate, endDate } = getPresetDateRange(
      preset as 'today' | 'week' | 'month' | 'year'
    );
    setDateRange([dayjs(startDate), dayjs(endDate)]);
  };

  const tabItems = [
    {
      key: 'overview',
      label: (
        <span>
          <FundOutlined /> 总览
        </span>
      ),
      children: (
        <OverviewTab
          dashboard={dashboardData as DashboardStatsDto | undefined}
          loading={isDashboardLoading}
          dateRange={dateRange}
        />
      ),
    },
    {
      key: 'cost',
      label: (
        <span>
          <DollarOutlined /> 成本分析
        </span>
      ),
      children: <CostAnalysisTab dateRange={dateRange} />,
    },
    {
      key: 'errors',
      label: (
        <span>
          <BugOutlined /> 错误分析
        </span>
      ),
      children: <ErrorAnalysisTab dateRange={dateRange} />,
    },
    {
      key: 'capability',
      label: (
        <span>
          <ThunderboltOutlined /> 能力使用
        </span>
      ),
      children: <CapabilityUsageTab dateRange={dateRange} />,
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 顶部日期过滤器 */}
      <Card size="small">
        <Space size="large">
          <Space>
            <Text type="secondary">日期范围:</Text>
            <RangePicker
              value={dateRange}
              onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])}
              format="YYYY-MM-DD"
            />
          </Space>
          <Space>
            <Text type="secondary">快捷:</Text>
            <Select
              size="small"
              style={{ width: 100 }}
              onChange={handlePresetChange}
              defaultValue="week"
              options={[
                { label: '今天', value: 'today' },
                { label: '本周', value: 'week' },
                { label: '本月', value: 'month' },
                { label: '本年', value: 'year' },
              ]}
            />
          </Space>
        </Space>
      </Card>

      {/* 主体 Tabs */}
      <Card>
        <Tabs defaultActiveKey="overview" items={tabItems} />
      </Card>
    </Space>
  );
};

export default AnalyticsDashboard;

export const routeConfig = {
  name: 'analytics',
  title: '数据分析中心',
  icon: 'LineChartOutlined',
  order: 30,
  requireAuth: true,
  requireAdmin: true,
};
