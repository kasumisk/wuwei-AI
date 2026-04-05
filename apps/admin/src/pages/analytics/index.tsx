import React, { useState } from 'react';
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
  Alert,
} from 'antd';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  useDashboard,
  useTimeSeries,
  useCostAnalysis,
  getPresetDateRange,
} from '../../services/analyticsService';
import type {
  TopClientDto,
  CapabilityUsageDto,
  ErrorTypeDto,
  TimeInterval,
  GroupBy,
} from '@ai-platform/shared';

const { RangePicker } = DatePicker;
const { Option } = Select;

// 图表配色
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const AnalyticsDashboard: React.FC = () => {
  // 日期范围状态
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => {
    const { startDate, endDate } = getPresetDateRange('week');
    return [dayjs(startDate), dayjs(endDate)];
  });

  // 时间序列配置
  const [timeInterval, setTimeInterval] = useState<TimeInterval>('day' as TimeInterval);
  const [timeSeriesMetric, setTimeSeriesMetric] = useState<
    'requests' | 'cost' | 'tokens' | 'responseTime'
  >('requests');

  // 成本分析配置
  const [costGroupBy, setCostGroupBy] = useState<GroupBy>('client' as GroupBy);

  // 获取数据
  const { data: dashboardData, isLoading: isDashboardLoading } = useDashboard({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
  });

  const { data: timeSeriesData, isLoading: isTimeSeriesLoading } = useTimeSeries({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    interval: timeInterval,
    metric: timeSeriesMetric,
  });

  const { data: costAnalysisData, isLoading: isCostAnalysisLoading } = useCostAnalysis({
    startDate: dateRange[0].toISOString(),
    endDate: dateRange[1].toISOString(),
    groupBy: costGroupBy,
  });

  // 处理日期预设选择
  const handlePresetChange = (preset: string) => {
    const { startDate, endDate } = getPresetDateRange(
      preset as 'today' | 'week' | 'month' | 'year'
    );
    setDateRange([dayjs(startDate), dayjs(endDate)]);
  };

  // 客户端排行表格列
  const topClientsColumns: ColumnsType<TopClientDto> = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: '客户端',
      dataIndex: 'clientName',
      key: 'clientName',
    },
    {
      title: '请求数',
      dataIndex: 'totalRequests',
      key: 'totalRequests',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (rate: number) => (
        <Tag color={rate >= 95 ? 'success' : rate >= 90 ? 'warning' : 'error'}>
          {rate.toFixed(2)}%
        </Tag>
      ),
    },
    {
      title: '平均延迟',
      dataIndex: 'avgResponseTime',
      key: 'avgResponseTime',
      render: (time: number) => `${time.toFixed(0)}ms`,
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      render: (cost: number) => `$${cost.toFixed(4)}`,
    },
  ];

  // 能力使用表格列
  const capabilityColumns: ColumnsType<CapabilityUsageDto> = [
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      key: 'capabilityType',
      render: (type: string) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '请求数',
      dataIndex: 'totalRequests',
      key: 'totalRequests',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (rate: number) => (
        <Tag color={rate >= 95 ? 'success' : rate >= 90 ? 'warning' : 'error'}>
          {rate.toFixed(2)}%
        </Tag>
      ),
    },
    {
      title: '平均延迟',
      dataIndex: 'avgResponseTime',
      key: 'avgResponseTime',
      render: (time: number) => `${time.toFixed(0)}ms`,
    },
    {
      title: '总 Tokens',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (tokens: number) => tokens?.toLocaleString() || '-',
    },
    {
      title: '总成本',
      dataIndex: 'totalCost',
      key: 'totalCost',
      render: (cost: number) => `$${cost.toFixed(4)}`,
    },
  ];

  // 错误表格列
  const errorColumns: ColumnsType<ErrorTypeDto> = [
    {
      title: '错误类型',
      dataIndex: 'errorCode',
      key: 'errorCode',
      render: (code: string) => <Tag color="error">{code}</Tag>,
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
    },
    {
      title: '出现次数',
      dataIndex: 'count',
      key: 'count',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (pct: number) => `${pct.toFixed(2)}%`,
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      {/* 顶部过滤器 */}
      <Card style={{ marginBottom: 24 }}>
        <Space size="large">
          <Space>
            <span>日期范围:</span>
            <RangePicker
              value={dateRange}
              onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])}
              format="YYYY-MM-DD"
            />
          </Space>
          <Space>
            <span>快捷选择:</span>
            <Select style={{ width: 120 }} onChange={handlePresetChange} defaultValue="week">
              <Option value="today">今天</Option>
              <Option value="week">本周</Option>
              <Option value="month">本月</Option>
              <Option value="year">本年</Option>
            </Select>
          </Space>
        </Space>
      </Card>

      {/* 概览统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card>
            <Statistic
              title="总请求数"
              value={(dashboardData as any)?.overview?.totalRequests || 0}
              prefix={<ApiOutlined />}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="成功率"
              value={(dashboardData as any)?.overview?.successRate || 0}
              suffix="%"
              prefix={<CheckCircleOutlined />}
              precision={2}
              valueStyle={{
                color:
                  ((dashboardData as any)?.overview?.successRate || 0) >= 95
                    ? '#3f8600'
                    : '#cf1322',
              }}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="平均延迟"
              value={(dashboardData as any)?.overview?.avgResponseTime || 0}
              suffix="ms"
              prefix={<ClockCircleOutlined />}
              precision={0}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="总成本"
              value={(dashboardData as any)?.overview?.totalCost || 0}
              precision={4}
              prefix={<DollarOutlined />}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="总 Tokens"
              value={(dashboardData as any)?.overview?.totalTokens || 0}
              prefix={<FileTextOutlined />}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="活跃客户"
              value={(dashboardData as any)?.overview?.uniqueClients || 0}
              prefix={<TeamOutlined />}
              loading={isDashboardLoading}
            />
          </Card>
        </Col>
      </Row>

      {/* 时间序列图表 */}
      <Card
        title="趋势分析"
        style={{ marginBottom: 24 }}
        extra={
          <Space>
            <Select style={{ width: 120 }} value={timeInterval} onChange={setTimeInterval}>
              <Option value="hour">按小时</Option>
              <Option value="day">按天</Option>
              <Option value="week">按周</Option>
              <Option value="month">按月</Option>
            </Select>
            <Select style={{ width: 120 }} value={timeSeriesMetric} onChange={setTimeSeriesMetric}>
              <Option value="requests">请求数</Option>
              <Option value="cost">成本</Option>
              <Option value="tokens">Tokens</Option>
              <Option value="responseTime">响应时间</Option>
            </Select>
          </Space>
        }
      >
        {isTimeSeriesLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : timeSeriesData && Array.isArray(timeSeriesData) && timeSeriesData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeSeriesData as any}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#8884d8"
                name={
                  timeSeriesMetric === 'requests'
                    ? '请求数'
                    : timeSeriesMetric === 'cost'
                      ? '成本 ($)'
                      : timeSeriesMetric === 'tokens'
                        ? 'Tokens'
                        : '响应时间 (ms)'
                }
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>

      {/* 客户端排行和能力使用 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="Top 客户端" loading={isDashboardLoading}>
            <Table
              columns={topClientsColumns}
              dataSource={(dashboardData as any)?.topClients || []}
              rowKey="clientId"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="能力使用统计" loading={isDashboardLoading}>
            <Table
              columns={capabilityColumns}
              dataSource={(dashboardData as any)?.capabilityUsage || []}
              rowKey="capabilityType"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>

      {/* 成本分析饼图 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card
            title="成本分布"
            extra={
              <Select style={{ width: 120 }} value={costGroupBy} onChange={setCostGroupBy}>
                <Option value="client">按客户端</Option>
                <Option value="capability">按能力</Option>
                <Option value="provider">按提供商</Option>
                <Option value="model">按模型</Option>
              </Select>
            }
          >
            {isCostAnalysisLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin size="large" />
              </div>
            ) : costAnalysisData &&
              Array.isArray(costAnalysisData) &&
              costAnalysisData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={costAnalysisData as any}
                    dataKey="totalCost"
                    nameKey="groupKey"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(entry: any) => `${entry.groupKey}: $${entry.totalCost.toFixed(2)}`}
                  >
                    {(costAnalysisData as any[]).map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={
              <Space>
                <WarningOutlined style={{ color: '#ff4d4f' }} />
                <span>最近错误</span>
              </Space>
            }
            loading={isDashboardLoading}
          >
            {(dashboardData as any)?.recentErrors &&
            (dashboardData as any).recentErrors.length > 0 ? (
              <Table
                columns={errorColumns}
                dataSource={(dashboardData as any).recentErrors}
                rowKey="errorCode"
                pagination={false}
                size="small"
              />
            ) : (
              <Empty description="暂无错误" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 提示信息 */}
      <Alert message="Dashboard 每 5 分钟自动刷新" type="info" showIcon closable />
    </div>
  );
};

export default AnalyticsDashboard;

export const routeConfig = {
  name: 'analytics',
  title: '统计分析',
  icon: 'LineChartOutlined',
  order: 42,
  requireAuth: true,
  requireAdmin: true,
};
