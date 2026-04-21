import React, { useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Space,
  Spin,
  Tag,
  Segmented,
  Tooltip,
  Typography,
  Divider,
  Progress,
} from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  FireOutlined,
  CrownOutlined,
  RiseOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  LikeOutlined,
  FunnelPlotOutlined,
  CameraOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  SwapOutlined,
  StopOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import dayjs from 'dayjs';
import {
  useDashboardActiveStats,
  useDashboardGrowth,
  useDashboardSubscriptionOverview,
  useDashboardAnalyticsOverview,
  useDashboardAnalysisStatistics,
  useDashboardRecommendQuality,
  useDashboardConversionSummary,
} from '@/services/dashboardService';
import { useQualityReport } from '@/services/foodPipelineService';

const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'dashboard',
  title: '仪表盘',
  icon: 'DashboardOutlined',
  order: 0,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 颜色常量 ====================

const TIER_COLORS: Record<string, string> = {
  free: '#8c8c8c',
  pro: '#1677ff',
  premium: '#722ed1',
};

const TIER_LABELS: Record<string, string> = {
  free: '免费版',
  pro: 'Pro',
  premium: 'Premium',
};

const CHANNEL_COLORS = ['#1677ff', '#52c41a', '#faad14', '#eb2f96', '#13c2c2'];

// ==================== 工具函数 ====================

function fmt7DayRange() {
  const endDate = dayjs().format('YYYY-MM-DD');
  const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
  return { startDate, endDate };
}

function fmt30DayRange() {
  const endDate = dayjs().format('YYYY-MM-DD');
  const startDate = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  return { startDate, endDate };
}

function fmtMrr(cents: number, currency: string) {
  const amount = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });
  return `${currency?.toUpperCase()} ${amount}`;
}

// ==================== 主页面组件 ====================

const Dashboard: React.FC = () => {
  const [growthDays, setGrowthDays] = useState(30);
  const { startDate, endDate } = useMemo(() => fmt7DayRange(), []);
  const { startDate: convStartDate, endDate: convEndDate } = useMemo(() => fmt30DayRange(), []);

  const {
    data: activeData,
    isLoading: activeLoading,
    dataUpdatedAt: activeUpdatedAt,
  } = useDashboardActiveStats();
  const { data: growthData, isLoading: growthLoading } = useDashboardGrowth(growthDays);
  const { data: subOverview, isLoading: subLoading } = useDashboardSubscriptionOverview();
  const { data: analyticsData, isLoading: analyticsLoading } = useDashboardAnalyticsOverview(
    startDate,
    endDate
  );
  const { data: analysisStats, isLoading: analysisLoading } = useDashboardAnalysisStatistics();
  const { data: recommendQuality, isLoading: recommendLoading } = useDashboardRecommendQuality(7);
  const { data: conversionSummary, isLoading: conversionLoading } = useDashboardConversionSummary(
    convStartDate,
    convEndDate
  );
  const { data: qualityReport, isLoading: _qualityLoading } = useQualityReport();

  const isLoading = activeLoading || growthLoading || subLoading || analyticsLoading;

  // ==================== KPI 卡片行 ====================

  const renderKpiRow = () => (
    <Row gutter={[16, 16]}>
      {/* 用户活跃 */}
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Statistic
            title="DAU（今日）"
            value={activeData?.dau ?? '-'}
            prefix={<UserOutlined style={{ color: '#1677ff' }} />}
            valueStyle={{ color: '#1677ff', fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Statistic
            title="WAU（7日）"
            value={activeData?.wau ?? '-'}
            prefix={<TeamOutlined style={{ color: '#52c41a' }} />}
            valueStyle={{ color: '#52c41a', fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Statistic
            title="MAU（30日）"
            value={activeData?.mau ?? '-'}
            prefix={<TeamOutlined style={{ color: '#722ed1' }} />}
            valueStyle={{ color: '#722ed1', fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Tooltip title="DAU / WAU，衡量日活粘性">
            <Statistic
              title="DAU/WAU 粘性"
              value={activeData?.dauWauRatio ?? '-'}
              suffix="%"
              prefix={<FireOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{
                color: activeData && activeData.dauWauRatio >= 30 ? '#52c41a' : '#faad14',
                fontSize: 22,
              }}
            />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Statistic
            title="付费订阅数"
            value={subOverview?.activeSubscriptions ?? '-'}
            prefix={<CrownOutlined style={{ color: '#722ed1' }} />}
            valueStyle={{ color: '#722ed1', fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable>
          <Statistic
            title="MRR"
            value={subOverview ? fmtMrr(subOverview.mrr, subOverview.currency) : '-'}
            prefix={<DollarOutlined style={{ color: '#13c2c2' }} />}
            valueStyle={{ color: '#13c2c2', fontSize: 20 }}
          />
        </Card>
      </Col>
    </Row>
  );

  // ==================== AI 能力快照行 ====================

  const renderAiRow = () => {
    if (!analyticsData) return null;
    return (
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card size="small" hoverable>
            <Statistic
              title="API 请求量（7日）"
              value={analyticsData.totalRequests}
              prefix={<ThunderboltOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" hoverable>
            <Statistic
              title="成功率"
              value={Number((analyticsData.successRate * 100).toFixed(1))}
              suffix="%"
              valueStyle={{
                color: analyticsData.successRate >= 0.99 ? '#52c41a' : '#faad14',
                fontSize: 20,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" hoverable>
            <Statistic
              title="平均延迟"
              value={Math.round(analyticsData.avgLatencyMs)}
              suffix="ms"
              valueStyle={{
                color: analyticsData.avgLatencyMs <= 500 ? '#52c41a' : '#ff4d4f',
                fontSize: 20,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" hoverable>
            <Statistic
              title="AI 成本（7日）"
              value={analyticsData.totalCostUsd?.toFixed(2)}
              prefix="$"
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>
    );
  };

  // ==================== 运营核心指标行（新增） ====================

  const renderOpsKpiRow = () => (
    <Row gutter={[16, 16]}>
      {/* 分析次数 */}
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={analysisLoading}>
          <Statistic
            title="今日分析次数"
            value={analysisStats?.todayCount ?? '-'}
            prefix={<CameraOutlined style={{ color: '#eb2f96' }} />}
            valueStyle={{ color: '#eb2f96', fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={analysisLoading}>
          <Statistic
            title="累计分析次数"
            value={analysisStats?.total ?? '-'}
            prefix={<FileTextOutlined style={{ color: '#8c8c8c' }} />}
            valueStyle={{ fontSize: 22 }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={analysisLoading}>
          <Tooltip title="AI 识别食物的平均置信度">
            <Statistic
              title="平均置信度"
              value={analysisStats ? Number((analysisStats.avgConfidence * 100).toFixed(1)) : '-'}
              suffix="%"
              prefix={<ExperimentOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{
                color: analysisStats && analysisStats.avgConfidence >= 0.8 ? '#52c41a' : '#faad14',
                fontSize: 22,
              }}
            />
          </Tooltip>
        </Card>
      </Col>

      {/* 转化率 */}
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={conversionLoading}>
          <Tooltip title="注册用户 → 付费用户的转化率（近30天）">
            <Statistic
              title="注册→付费转化率"
              value={
                conversionSummary
                  ? Number((conversionSummary.overallConversionRate * 100).toFixed(1))
                  : '-'
              }
              suffix="%"
              prefix={<FunnelPlotOutlined style={{ color: '#13c2c2' }} />}
              valueStyle={{
                color:
                  conversionSummary && conversionSummary.overallConversionRate >= 0.05
                    ? '#52c41a'
                    : '#faad14',
                fontSize: 22,
              }}
            />
          </Tooltip>
        </Card>
      </Col>

      {/* 推荐接受率 */}
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={recommendLoading}>
          <Tooltip title="用户接受推荐食物的比例（近7天）">
            <Statistic
              title="推荐接受率"
              value={
                recommendQuality ? Number((recommendQuality.acceptanceRate * 100).toFixed(1)) : '-'
              }
              suffix="%"
              prefix={<LikeOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{
                color:
                  recommendQuality && recommendQuality.acceptanceRate >= 0.6
                    ? '#52c41a'
                    : '#faad14',
                fontSize: 22,
              }}
            />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" hoverable loading={recommendLoading}>
          <Tooltip title="用户替换/跳过推荐的比例（近7天）">
            <Statistic
              title="替换/跳过率"
              value={
                recommendQuality
                  ? Number(
                      (
                        (recommendQuality.replacementRate + recommendQuality.skipRate) *
                        100
                      ).toFixed(1)
                    )
                  : '-'
              }
              suffix="%"
              prefix={<SwapOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{
                color:
                  recommendQuality &&
                  recommendQuality.replacementRate + recommendQuality.skipRate <= 0.3
                    ? '#52c41a'
                    : '#ff4d4f',
                fontSize: 22,
              }}
            />
          </Tooltip>
        </Card>
      </Col>
    </Row>
  );

  // ==================== 推荐质量迷你图（新增） ====================

  const renderRecommendQualityCard = () => {
    if (!recommendQuality) return null;
    const data = [
      { name: '接受', value: recommendQuality.acceptanceRate * 100, color: '#52c41a' },
      { name: '替换', value: recommendQuality.replacementRate * 100, color: '#faad14' },
      { name: '跳过', value: recommendQuality.skipRate * 100, color: '#ff4d4f' },
    ];

    return (
      <Card
        title={
          <Space>
            <LikeOutlined />
            <span>推荐质量分布（7日）</span>
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Tag color="green">活跃用户 {recommendQuality.activeUsers}</Tag>
            <Tag>日均反馈 {recommendQuality.avgDailyFeedbacks.toFixed(0)}</Tag>
          </Space>
        }
      >
        <Row gutter={16} align="middle">
          {data.map((item) => (
            <Col xs={8} key={item.name}>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="dashboard"
                  percent={Number(item.value.toFixed(1))}
                  size={100}
                  strokeColor={item.color}
                  format={(pct) => (
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 600, color: item.color }}>{pct}%</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{item.name}</div>
                    </div>
                  )}
                />
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    );
  };

  // ==================== 分析类型分布迷你图（新增） ====================

  const renderAnalysisBreakdownCard = () => {
    if (!analysisStats) return null;
    const { byInputType, byReviewStatus } = analysisStats;
    const total = analysisStats.total || 1;

    return (
      <Card
        title={
          <Space>
            <ExperimentOutlined />
            <span>分析记录概况</span>
          </Space>
        }
        size="small"
        extra={
          <Tag color={byReviewStatus?.pending > 10 ? 'red' : 'default'}>
            待审核 {byReviewStatus?.pending}
          </Tag>
        }
      >
        <Row gutter={[16, 12]}>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              输入类型分布
            </Text>
            <div style={{ marginTop: 4 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                <div>
                  <Space>
                    <CameraOutlined style={{ color: '#1677ff' }} />
                    <Text>图片</Text>
                    <Text strong>{byInputType?.image}</Text>
                    <Text type="secondary">
                      ({((byInputType?.image / total) * 100).toFixed(0)}%)
                    </Text>
                  </Space>
                </div>
                <div>
                  <Space>
                    <FileTextOutlined style={{ color: '#52c41a' }} />
                    <Text>文本</Text>
                    <Text strong>{byInputType?.text}</Text>
                    <Text type="secondary">
                      ({((byInputType?.text / total) * 100).toFixed(0)}%)
                    </Text>
                  </Space>
                </div>
              </Space>
            </div>
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              审核状态分布
            </Text>
            <div style={{ marginTop: 4 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                <div>
                  <Space>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <Text>已通过</Text>
                    <Text strong>{byReviewStatus?.approved}</Text>
                  </Space>
                </div>
                <div>
                  <Space>
                    <ClockCircleOutlined style={{ color: '#faad14' }} />
                    <Text>待审核</Text>
                    <Text strong>{byReviewStatus?.pending}</Text>
                  </Space>
                </div>
                <div>
                  <Space>
                    <StopOutlined style={{ color: '#ff4d4f' }} />
                    <Text>已拒绝</Text>
                    <Text strong>{byReviewStatus?.rejected}</Text>
                  </Space>
                </div>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>
    );
  };

  // ==================== 日活趋势图 ====================

  const renderDailyTrendChart = () => {
    const trendData = activeData?.dailyActiveTrend;
    if (!trendData?.length) return null;

    return (
      <Card
        title={
          <Space>
            <FireOutlined />
            <span>日活跃用户趋势</span>
            {activeUpdatedAt > 0 && (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                {dayjs(activeUpdatedAt).format('HH:mm')} 更新
              </Text>
            )}
          </Space>
        }
        size="small"
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1677ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#1677ff" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => dayjs(v).format('MM/DD')}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <ReTooltip
              formatter={((val: number) => [val, '活跃用户']) as any}
              labelFormatter={(label) => dayjs(label).format('YYYY-MM-DD')}
            />
            <Area
              type="monotone"
              dataKey="count"
              name="活跃用户"
              stroke="#1677ff"
              fill="url(#dauGradient)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    );
  };

  // ==================== 增长趋势图 ====================

  const renderGrowthChart = () => {
    const trend = growthData?.trend;
    if (!trend?.length) return null;

    return (
      <Card
        title={
          <Space>
            <RiseOutlined />
            <span>
              用户增长（近 {growthDays} 天新增{' '}
              <Text strong style={{ color: '#1677ff' }}>
                {growthData?.periodNewUsers}
              </Text>{' '}
              人，累计{' '}
              <Text strong style={{ color: '#52c41a' }}>
                {growthData?.totalUsers}
              </Text>{' '}
              人）
            </span>
          </Space>
        }
        size="small"
        extra={
          <Segmented
            size="small"
            value={growthDays}
            onChange={(val) => setGrowthDays(val as number)}
            options={[
              { label: '7天', value: 7 },
              { label: '30天', value: 30 },
              { label: '90天', value: 90 },
            ]}
          />
        }
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trend}>
            <defs>
              <linearGradient id="newGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1677ff" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#1677ff" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="cumulativeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#52c41a" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#52c41a" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => dayjs(v).format('MM/DD')}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
            <ReTooltip labelFormatter={(label) => dayjs(label).format('YYYY-MM-DD')} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="count"
              name="新增"
              stroke="#1677ff"
              fill="url(#newGradient)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="cumulative"
              name="累计"
              stroke="#52c41a"
              fill="url(#cumulativeGradient)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    );
  };

  // ==================== 订阅分布图 ====================

  const renderSubscriptionCharts = () => {
    if (!subOverview) return null;
    const { byTier, byChannel } = subOverview;

    const tierData = byTier
      ? Object.entries(byTier).map(([tier, count]) => ({
          tier,
          label: TIER_LABELS[tier] ?? tier,
          count,
        }))
      : [];

    const channelData = byChannel
      ? Object.entries(byChannel).map(([channel, count]) => ({
          channel,
          count,
        }))
      : [];

    return (
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="订阅套餐分布" size="small">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={tierData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="label" type="category" width={70} tick={{ fontSize: 11 }} />
                <ReTooltip formatter={((val: number) => [val, '用户数']) as any} />
                <Bar dataKey="count" name="用户数" radius={[0, 4, 4, 0]}>
                  {tierData.map((entry) => (
                    <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] ?? '#1677ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="支付渠道分布" size="small">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={channelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="channel" type="category" width={90} tick={{ fontSize: 11 }} />
                <ReTooltip formatter={((val: number) => [val, '用户数']) as any} />
                <Bar dataKey="count" name="用户数" radius={[0, 4, 4, 0]}>
                  {channelData.map((entry, i) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    );
  };

  // ==================== 食物库数据质量卡片（V8.0 新增） ====================

  const renderFoodQualityCard = () => {
    if (!qualityReport) return null;

    const { completeness, totalFoods, enrichment, fieldCompleteness } = qualityReport;
    const total = totalFoods || 1;

    // 核心完整度指标
    const coreMetrics = [
      { label: '宏量营养素', value: completeness.withProtein, color: '#1677ff' },
      { label: '微量营养素', value: completeness.withMicronutrients, color: '#52c41a' },
      { label: '过敏原', value: completeness.withAllergens, color: '#faad14' },
      { label: '餐型标签', value: completeness.withTags, color: '#13c2c2' },
      { label: '图片', value: completeness.withImage, color: '#722ed1' },
      { label: '兼容性', value: completeness.withCompatibility, color: '#eb2f96' },
    ];

    // 挑选 fieldCompleteness 中最低的5个字段展示
    const worstFields = fieldCompleteness
      ? [...fieldCompleteness].sort((a, b) => a.percentage - b.percentage).slice(0, 5)
      : [];

    return (
      <Card
        title={
          <Space>
            <DatabaseOutlined />
            <span>食物库数据质量</span>
            <Tag color="blue">{totalFoods} 条</Tag>
          </Space>
        }
        size="small"
        extra={
          enrichment && (
            <Space size={4}>
              <Tooltip title="核心营养素覆盖率">
                <Tag color="green">核心 {enrichment.coreCoverage?.toFixed(1)}%</Tag>
              </Tooltip>
              <Tooltip title="微量营养素覆盖率">
                <Tag color="blue">微量 {enrichment.microCoverage?.toFixed(1)}%</Tag>
              </Tooltip>
            </Space>
          )
        }
      >
        <Row gutter={[16, 12]}>
          {/* 左侧：核心维度完整度进度条 */}
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              核心维度覆盖率
            </Text>
            <div style={{ marginTop: 8 }}>
              {coreMetrics.map((m) => (
                <div key={m.label} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 2,
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{m.label}</Text>
                    <Text style={{ fontSize: 12, color: m.color }}>
                      {m.value}/{total} ({((m.value / total) * 100).toFixed(0)}%)
                    </Text>
                  </div>
                  <Progress
                    percent={Number(((m.value / total) * 100).toFixed(1))}
                    size="small"
                    strokeColor={m.color}
                    showInfo={false}
                  />
                </div>
              ))}
            </div>
          </Col>

          {/* 右侧：最薄弱的5个字段 + AI补全统计 */}
          <Col xs={24} md={12}>
            {worstFields.length > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  最薄弱字段 TOP5
                </Text>
                <div style={{ marginTop: 8 }}>
                  {worstFields.map((f) => (
                    <div key={f.field} style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 2,
                        }}
                      >
                        <Text style={{ fontSize: 12 }}>{f.field}</Text>
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {f.filledCount}/{f.totalCount} ({f.percentage.toFixed(1)}%)
                        </Text>
                      </div>
                      <Progress
                        percent={Number(f.percentage.toFixed(1))}
                        size="small"
                        strokeColor={f.percentage < 30 ? '#ff4d4f' : '#faad14'}
                        showInfo={false}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {enrichment && (
              <div style={{ marginTop: worstFields.length > 0 ? 12 : 0 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI补全统计
                </Text>
                <Row gutter={8} style={{ marginTop: 4 }}>
                  <Col span={6}>
                    <Statistic
                      title={<span style={{ fontSize: 11 }}>直接入库</span>}
                      value={enrichment.directApplied}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={<span style={{ fontSize: 11 }}>待审核</span>}
                      value={enrichment.staged}
                      valueStyle={{ fontSize: 16, color: '#faad14' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={<span style={{ fontSize: 11 }}>已通过</span>}
                      value={enrichment.approved}
                      valueStyle={{ fontSize: 16, color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={<span style={{ fontSize: 11 }}>已拒绝</span>}
                      value={enrichment.rejected}
                      valueStyle={{ fontSize: 16, color: '#ff4d4f' }}
                    />
                  </Col>
                </Row>
              </div>
            )}
          </Col>
        </Row>
      </Card>
    );
  };

  // ==================== 补全趋势图（V8.0 新增） ====================

  const renderEnrichmentTrendChart = () => {
    const trend = qualityReport?.enrichmentTrend;
    if (!trend?.length) return null;

    return (
      <Card
        title={
          <Space>
            <RiseOutlined />
            <span>AI补全趋势（近30天）</span>
          </Space>
        }
        size="small"
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => dayjs(v).format('MM/DD')}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <ReTooltip labelFormatter={(label) => dayjs(label).format('YYYY-MM-DD')} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="enrichedCount"
              name="补全数"
              stroke="#1677ff"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="approvedCount"
              name="审核通过"
              stroke="#52c41a"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="rejectedCount"
              name="审核拒绝"
              stroke="#ff4d4f"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 3"
              activeDot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    );
  };

  // ==================== 快速入口 ====================

  const renderQuickLinks = () => (
    <Card title="快速入口" size="small">
      <Row gutter={[8, 8]}>
        {[
          { label: '用户画像', href: '/analytics/user-profile-dashboard', color: 'blue' },
          { label: '转化漏斗', href: '/analytics/funnel', color: 'green' },
          { label: '订阅管理', href: '/subscription/list', color: 'purple' },
          { label: 'A/B 实验', href: '/ab-experiments/list', color: 'orange' },
          { label: '策略管理', href: '/strategy/list', color: 'geekblue' },
          { label: '推荐调试', href: '/recommendation-debug', color: 'volcano' },
          { label: 'AI补全管理', href: '/food-library/enrichment', color: 'cyan' },
        ].map(({ label, href, color }) => (
          <Col key={href}>
            <Tag
              color={color}
              style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 13 }}
              onClick={() => (window.location.href = href)}
            >
              {label}
            </Tag>
          </Col>
        ))}
      </Row>
    </Card>
  );

  // ==================== 渲染 ====================

  return (
    <Spin spinning={isLoading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* KPI 核心指标 */}
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <ReloadOutlined style={{ marginRight: 4 }} />
              数据每 5 分钟自动刷新
            </Text>
          </Space>
          {renderKpiRow()}
        </div>

        {/* 运营核心指标（新增：分析次数、转化率、推荐接受率） */}
        <div>
          <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
            运营核心指标
          </Divider>
          {renderOpsKpiRow()}
        </div>

        {/* AI 能力快照 */}
        {analyticsData && (
          <div>
            <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
              AI 能力（过去 7 天）
            </Divider>
            {renderAiRow()}
          </div>
        )}

        {/* 推荐质量 + 分析概况 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            {renderRecommendQualityCard()}
          </Col>
          <Col xs={24} lg={12}>
            {renderAnalysisBreakdownCard()}
          </Col>
        </Row>

        {/* 趋势图区域 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            {renderDailyTrendChart()}
          </Col>
          <Col xs={24} lg={12}>
            {renderGrowthChart()}
          </Col>
        </Row>

        {/* 订阅分布 */}
        {subOverview && (
          <div>
            <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
              订阅概览
            </Divider>
            {renderSubscriptionCharts()}
          </div>
        )}

        {/* V8.0: 食物库数据质量 + 补全趋势 */}
        {qualityReport && (
          <div>
            <Divider orientation="left" plain style={{ fontSize: 13, color: '#8c8c8c' }}>
              食物库数据质量
            </Divider>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={14}>
                {renderFoodQualityCard()}
              </Col>
              <Col xs={24} lg={10}>
                {renderEnrichmentTrendChart()}
              </Col>
            </Row>
          </div>
        )}

        {/* 快速入口 */}
        {renderQuickLinks()}
      </Space>
    </Spin>
  );
};

export default Dashboard;
