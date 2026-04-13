import React, { useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Space,
  Spin,
  Empty,
  Tag,
  Segmented,
  Progress,
  Alert,
  Typography,
  Table,
} from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  RiseOutlined,
  AlertOutlined,
  TrophyOutlined,
  HeartOutlined,
  DashboardOutlined,
  FireOutlined,
  WarningOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useGrowthTrend,
  useProfileDistribution,
  useActiveStats,
} from '@/services/userDashboardService';

export const routeConfig = {
  name: 'analytics-user-dashboard',
  title: '用户画像',
  icon: 'TeamOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 颜色配置 ====================

const COLORS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#eb2f96',
  '#722ed1',
  '#13c2c2',
  '#fa541c',
  '#2f54eb',
];

const churnRiskColors: Record<string, string> = {
  low: '#52c41a',
  medium: '#faad14',
  high: '#ff4d4f',
};

const complianceColors: Record<string, string> = {
  excellent: '#52c41a',
  good: '#1677ff',
  fair: '#faad14',
  poor: '#ff4d4f',
};

const complianceLabels: Record<string, string> = {
  excellent: '优秀 (>=80%)',
  good: '良好 (60-80%)',
  fair: '一般 (40-60%)',
  poor: '较差 (<40%)',
};

const churnRiskLabels: Record<string, string> = {
  low: '低风险 (<30%)',
  medium: '中风险 (30-60%)',
  high: '高风险 (>=60%)',
};

// ==================== 主组件 ====================

const UserProfileDashboardPage: React.FC = () => {
  const [growthDays, setGrowthDays] = useState<number>(30);
  const [growthGranularity, setGrowthGranularity] = useState<string>('day');
  const [distributionDays, setDistributionDays] = useState<number>(90);
  const [activeDays, setActiveDays] = useState<number>(30);

  const { data: growthData, isLoading: growthLoading } = useGrowthTrend(
    growthDays,
    growthGranularity
  );
  const { data: distData, isLoading: distLoading } = useProfileDistribution(distributionDays);
  const { data: activeData, isLoading: activeLoading } = useActiveStats(activeDays);

  // ==================== 运营健康度计算 ====================

  const healthScore = useMemo(() => {
    if (!activeData || !distData) return null;

    const { dauWauRatio, wauMauRatio, bannedUsers, totalUsers } = activeData;
    const { onboarding, behaviorStats, distributions } = distData;

    // 粘性评分 (0-25)
    const stickinessScore = Math.min(25, (dauWauRatio / 50) * 12.5 + (wauMauRatio / 60) * 12.5);

    // Onboarding 完成率评分 (0-20)
    const onboardingScore = Math.min(20, (onboarding.completionRate / 100) * 20);

    // 依从率评分 (0-25)
    const complianceScore = Math.min(25, (behaviorStats.avgComplianceRate / 1) * 25);

    // 低流失风险占比评分 (0-20)
    const totalChurn = distributions.churnRisk.reduce((sum, d) => sum + d.count, 0);
    const lowRiskCount = distributions.churnRisk.find((d) => d.segment === 'low')?.count || 0;
    const lowRiskRatio = totalChurn > 0 ? lowRiskCount / totalChurn : 0;
    const churnScore = Math.min(20, lowRiskRatio * 20);

    // 封禁率惩罚 (0-10)
    const banRatio = totalUsers > 0 ? bannedUsers / totalUsers : 0;
    const banPenalty = Math.min(10, banRatio * 100);

    const total = Math.round(
      stickinessScore + onboardingScore + complianceScore + churnScore - banPenalty
    );
    const clamped = Math.max(0, Math.min(100, total));

    return {
      total: clamped,
      stickinessScore: Math.round(stickinessScore),
      onboardingScore: Math.round(onboardingScore),
      complianceScore: Math.round(complianceScore),
      churnScore: Math.round(churnScore),
      banPenalty: Math.round(banPenalty),
    };
  }, [activeData, distData]);

  // ==================== 增长速度 (环比) ====================

  const growthVelocity = useMemo(() => {
    if (!growthData || growthData.trend.length < 2) return null;
    const trend = growthData.trend;
    const half = Math.floor(trend.length / 2);
    const firstHalf = trend.slice(0, half).reduce((s, t) => s + t.count, 0);
    const secondHalf = trend.slice(half).reduce((s, t) => s + t.count, 0);
    if (firstHalf === 0) return { ratio: secondHalf > 0 ? 100 : 0, accelerating: secondHalf > 0 };
    const ratio = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
    return { ratio, accelerating: ratio > 0 };
  }, [growthData]);

  // ==================== 用户分群洞察 ====================

  const segmentInsights = useMemo(() => {
    if (!distData || !activeData) return [];
    const insights: Array<{ type: 'success' | 'warning' | 'error' | 'info'; message: string }> = [];

    const { distributions, onboarding, behaviorStats, inferredStats: _inferredStats } = distData;

    // Onboarding 完成率检查
    if (onboarding.completionRate < 50) {
      insights.push({
        type: 'warning',
        message: `Onboarding 完成率仅 ${onboarding.completionRate}%，建议优化引导流程，未完成用户 ${onboarding.totalProfiles - onboarding.completedOnboarding} 人`,
      });
    } else if (onboarding.completionRate >= 80) {
      insights.push({
        type: 'success',
        message: `Onboarding 完成率 ${onboarding.completionRate}%，引导流程健康`,
      });
    }

    // 高流失风险检查
    const totalChurn = distributions.churnRisk.reduce((s, d) => s + d.count, 0);
    const highRisk = distributions.churnRisk.find((d) => d.segment === 'high')?.count || 0;
    if (totalChurn > 0 && highRisk / totalChurn > 0.3) {
      insights.push({
        type: 'error',
        message: `高流失风险用户占比 ${((highRisk / totalChurn) * 100).toFixed(1)}%（${highRisk} 人），建议启动流失干预`,
      });
    }

    // 依从率检查
    if (behaviorStats.avgComplianceRate < 0.4) {
      insights.push({
        type: 'warning',
        message: `平均依从率 ${(behaviorStats.avgComplianceRate * 100).toFixed(1)}%，用户参与度偏低`,
      });
    }

    // 粘性检查
    if (activeData.dauWauRatio < 15) {
      insights.push({
        type: 'warning',
        message: `DAU/WAU 粘性 ${activeData.dauWauRatio}%，低于健康阈值 15%，建议增加每日触达`,
      });
    }

    // 封禁用户检查
    if (activeData.bannedUsers > 0) {
      const banRate = ((activeData.bannedUsers / activeData.totalUsers) * 100).toFixed(2);
      insights.push({
        type: 'info',
        message: `当前封禁用户 ${activeData.bannedUsers} 人（${banRate}%）`,
      });
    }

    // 增长速度
    if (growthVelocity) {
      if (growthVelocity.ratio < -30) {
        insights.push({
          type: 'error',
          message: `增长放缓：后半周期新增环比下降 ${Math.abs(growthVelocity.ratio)}%，需要关注获客渠道`,
        });
      } else if (growthVelocity.ratio > 30) {
        insights.push({
          type: 'success',
          message: `增长加速：后半周期新增环比增长 ${growthVelocity.ratio}%`,
        });
      }
    }

    return insights;
  }, [distData, activeData, growthVelocity]);

  // ==================== 注册渠道增长构成 ====================

  const authTypeGrowthData = useMemo(() => {
    if (!growthData) return [];
    return growthData.trend.map((t) => ({
      date: t.date,
      total: t.count,
      ...t.byAuthType,
    }));
  }, [growthData]);

  const authTypeKeys = useMemo(() => {
    if (!growthData || growthData.trend.length === 0) return [];
    const keys = new Set<string>();
    growthData.trend.forEach((t) => {
      Object.keys(t.byAuthType || {}).forEach((k) => keys.add(k));
    });
    return Array.from(keys);
  }, [growthData]);

  // ==================== 健康度雷达 ====================

  const radarData = useMemo(() => {
    if (!healthScore) return [];
    return [
      { dimension: '用户粘性', value: (healthScore.stickinessScore / 25) * 100, fullMark: 100 },
      { dimension: 'Onboarding', value: (healthScore.onboardingScore / 20) * 100, fullMark: 100 },
      { dimension: '依从率', value: (healthScore.complianceScore / 25) * 100, fullMark: 100 },
      { dimension: '低流失占比', value: (healthScore.churnScore / 20) * 100, fullMark: 100 },
      {
        dimension: '安全(低封禁)',
        value: Math.max(0, (1 - healthScore.banPenalty / 10) * 100),
        fullMark: 100,
      },
    ];
  }, [healthScore]);

  // ==================== 分群摘要表 ====================

  const segmentSummaryData = useMemo(() => {
    if (!distData) return [];
    const { distributions } = distData;
    const totalGoal = distributions.goal.reduce((s, g) => s + g.count, 0);

    return distributions.goal.map((g, i) => ({
      key: g.goal,
      goal: g.goal,
      count: g.count,
      percentage: totalGoal > 0 ? ((g.count / totalGoal) * 100).toFixed(1) : '0',
      color: COLORS[i % COLORS.length],
    }));
  }, [distData]);

  const segmentColumns: ColumnsType<(typeof segmentSummaryData)[0]> = [
    {
      title: '目标类型',
      dataIndex: 'goal',
      render: (val: string, record) => <Tag color={record.color}>{val || '未设置'}</Tag>,
    },
    {
      title: '用户数',
      dataIndex: 'count',
      sorter: (a, b) => a.count - b.count,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      render: (val: string) => `${val}%`,
      sorter: (a, b) => parseFloat(a.percentage) - parseFloat(b.percentage),
    },
    {
      title: '占比条',
      key: 'bar',
      width: 200,
      render: (_, record) => (
        <Progress
          percent={parseFloat(record.percentage)}
          showInfo={false}
          strokeColor={record.color}
          size="small"
        />
      ),
    },
  ];

  // ==================== 活跃指标卡 ====================

  const renderActiveCards = () => {
    if (!activeData) return null;
    return (
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="DAU (今日)"
              value={activeData.dau}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="WAU (7日)"
              value={activeData.wau}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="MAU (30日)"
              value={activeData.mau}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="总用户数" value={activeData.totalUsers} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="DAU/WAU 粘性"
              value={activeData.dauWauRatio}
              suffix="%"
              prefix={<FireOutlined />}
              valueStyle={{
                color: activeData.dauWauRatio >= 30 ? '#52c41a' : '#faad14',
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="WAU/MAU 粘性"
              value={activeData.wauMauRatio}
              suffix="%"
              prefix={<FireOutlined />}
              valueStyle={{
                color: activeData.wauMauRatio >= 40 ? '#52c41a' : '#faad14',
              }}
            />
          </Card>
        </Col>
      </Row>
    );
  };

  // ==================== 运营健康度 + 雷达 ====================

  const renderHealthScore = () => {
    if (!healthScore) return null;
    const color =
      healthScore.total >= 70 ? '#52c41a' : healthScore.total >= 40 ? '#faad14' : '#ff4d4f';
    const label = healthScore.total >= 70 ? '健康' : healthScore.total >= 40 ? '一般' : '需关注';
    return (
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card
            title={
              <Space>
                <SafetyCertificateOutlined />
                <span>运营健康度</span>
              </Space>
            }
            size="small"
          >
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <Progress
                type="dashboard"
                percent={healthScore.total}
                strokeColor={color}
                format={() => (
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color }}>{healthScore.total}</div>
                    <Tag color={color}>{label}</Tag>
                  </div>
                )}
                size={150}
              />
            </div>
            <Row gutter={[8, 4]} style={{ marginTop: 8 }}>
              <Col span={12}>
                <Typography.Text type="secondary">粘性</Typography.Text>
                <Progress
                  percent={(healthScore.stickinessScore / 25) * 100}
                  size="small"
                  showInfo={false}
                  strokeColor="#1677ff"
                />
              </Col>
              <Col span={12}>
                <Typography.Text type="secondary">Onboarding</Typography.Text>
                <Progress
                  percent={(healthScore.onboardingScore / 20) * 100}
                  size="small"
                  showInfo={false}
                  strokeColor="#52c41a"
                />
              </Col>
              <Col span={12}>
                <Typography.Text type="secondary">依从率</Typography.Text>
                <Progress
                  percent={(healthScore.complianceScore / 25) * 100}
                  size="small"
                  showInfo={false}
                  strokeColor="#722ed1"
                />
              </Col>
              <Col span={12}>
                <Typography.Text type="secondary">低流失</Typography.Text>
                <Progress
                  percent={(healthScore.churnScore / 20) * 100}
                  size="small"
                  showInfo={false}
                  strokeColor="#13c2c2"
                />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="健康度雷达" size="small">
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="健康度"
                  dataKey="value"
                  stroke="#1677ff"
                  fill="#1677ff"
                  fillOpacity={0.25}
                />
                <Tooltip formatter={((val: number) => `${val.toFixed(0)}%`) as any} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={8}>
          <Card
            title={
              <Space>
                <AlertOutlined />
                <span>分群洞察 ({segmentInsights.length})</span>
              </Space>
            }
            size="small"
          >
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {segmentInsights.length === 0 ? (
                <Empty description="暂无洞察" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {segmentInsights.map((insight, i) => (
                    <Alert
                      key={i}
                      type={insight.type}
                      message={insight.message}
                      showIcon
                      banner
                      style={{ fontSize: 12 }}
                    />
                  ))}
                </Space>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    );
  };

  // ==================== 日活趋势 ====================

  const renderDailyActiveTrend = () => {
    if (!activeData || !activeData.dailyActiveTrend?.length) return null;
    return (
      <Card
        title="日活跃用户趋势"
        size="small"
        extra={
          <Segmented
            value={activeDays}
            onChange={(val) => setActiveDays(val as number)}
            options={[
              { label: '7天', value: 7 },
              { label: '14天', value: 14 },
              { label: '30天', value: 30 },
              { label: '60天', value: 60 },
            ]}
          />
        }
      >
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={activeData.dailyActiveTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="count"
              name="活跃用户"
              stroke="#1677ff"
              fill="#1677ff"
              fillOpacity={0.15}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    );
  };

  // ==================== 增长趋势 + 渠道构成 ====================

  const renderGrowthTrend = () => {
    if (!growthData) return null;
    return (
      <Row gutter={[16, 16]}>
        <Col span={14}>
          <Card
            title={
              <Space>
                <RiseOutlined />
                <span>
                  用户增长趋势（近 {growthDays} 天新增 {growthData.periodNewUsers} 人，累计{' '}
                  {growthData.totalUsers} 人）
                </span>
                {growthVelocity && (
                  <Tag
                    color={growthVelocity.accelerating ? 'success' : 'error'}
                    icon={growthVelocity.accelerating ? <RiseOutlined /> : <WarningOutlined />}
                  >
                    环比 {growthVelocity.ratio > 0 ? '+' : ''}
                    {growthVelocity.ratio}%
                  </Tag>
                )}
              </Space>
            }
            size="small"
            extra={
              <Space>
                <Segmented
                  value={growthGranularity}
                  onChange={(val) => setGrowthGranularity(val as string)}
                  options={[
                    { label: '按日', value: 'day' },
                    { label: '按周', value: 'week' },
                    { label: '按月', value: 'month' },
                  ]}
                />
                <Segmented
                  value={growthDays}
                  onChange={(val) => setGrowthDays(val as number)}
                  options={[
                    { label: '7天', value: 7 },
                    { label: '30天', value: 30 },
                    { label: '90天', value: 90 },
                    { label: '180天', value: 180 },
                  ]}
                />
              </Space>
            }
          >
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={growthData.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="count"
                  name="新增"
                  fill="#1677ff"
                  fillOpacity={0.7}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulative"
                  name="累计"
                  stroke="#52c41a"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        {/* 渠道构成堆积面积图 */}
        <Col span={10}>
          <Card title="注册渠道构成趋势" size="small">
            {authTypeKeys.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={authTypeGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {authTypeKeys.map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stackId="1"
                      stroke={COLORS[i % COLORS.length]}
                      fill={COLORS[i % COLORS.length]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="无渠道数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>
    );
  };

  // ==================== 画像分布 ====================

  const renderDistributions = () => {
    if (!distData) return null;
    const { distributions, onboarding, behaviorStats, inferredStats } = distData;

    return (
      <>
        {/* Onboarding + 行为 + 推断 概览 */}
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Card title="Onboarding 完成率" size="small">
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="circle"
                  percent={onboarding.completionRate}
                  format={(pct) => `${pct}%`}
                  strokeColor={onboarding.completionRate >= 60 ? '#52c41a' : '#faad14'}
                />
                <div style={{ marginTop: 12, color: '#999' }}>
                  {onboarding.completedOnboarding} / {onboarding.totalProfiles} 用户
                </div>
              </div>
            </Card>
          </Col>
          <Col span={9}>
            <Card title="行为画像统计" size="small">
              <Row gutter={[8, 8]}>
                <Col span={12}>
                  <Statistic
                    title="有行为画像用户"
                    value={behaviorStats.totalWithBehavior}
                    prefix={<UserOutlined />}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="平均依从率"
                    value={(behaviorStats.avgComplianceRate * 100).toFixed(1)}
                    suffix="%"
                    prefix={<HeartOutlined />}
                    valueStyle={{
                      color: behaviorStats.avgComplianceRate >= 0.6 ? '#52c41a' : '#faad14',
                    }}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="平均连续天数"
                    value={behaviorStats.avgStreakDays}
                    suffix="天"
                    prefix={<FireOutlined />}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="最长连续记录"
                    value={behaviorStats.maxLongestStreak}
                    suffix="天"
                    prefix={<TrophyOutlined />}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
          <Col span={9}>
            <Card title="推断画像统计" size="small">
              <Row gutter={[8, 8]}>
                <Col span={12}>
                  <Statistic
                    title="有推断画像用户"
                    value={inferredStats.totalWithInferred}
                    prefix={<DashboardOutlined />}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="平均流失风险"
                    value={(inferredStats.avgChurnRisk * 100).toFixed(1)}
                    suffix="%"
                    prefix={<AlertOutlined />}
                    valueStyle={{
                      color: inferredStats.avgChurnRisk < 0.3 ? '#52c41a' : '#ff4d4f',
                    }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="平均 BMR" value={inferredStats.avgBMR} suffix="kcal" />
                </Col>
                <Col span={8}>
                  <Statistic title="平均 TDEE" value={inferredStats.avgTDEE} suffix="kcal" />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="推荐热量"
                    value={inferredStats.avgRecommendedCalories}
                    suffix="kcal"
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 目标类型分群摘要表 + 饼图 */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={12}>
            <Card title="目标类型分群摘要" size="small">
              <Table
                dataSource={segmentSummaryData}
                columns={segmentColumns}
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card title="注册渠道分布" size="small">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={distributions.authType}
                    dataKey="count"
                    nameKey="authType"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ authType, count }: any) => `${authType}: ${count}`}
                  >
                    {distributions.authType.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>
          <Col span={6}>
            <Card title="性别分布" size="small">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={distributions.gender}
                    dataKey="count"
                    nameKey="gender"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ gender, count }: any) => `${gender}: ${count}`}
                  >
                    {distributions.gender.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        </Row>

        {/* 风险 & 依从率 & 活动等级分布 */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={8}>
            <Card title="流失风险分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={distributions.churnRisk.map((d) => ({
                      ...d,
                      label: churnRiskLabels[d.segment] || d.segment,
                    }))}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ label, count }: any) => `${label}: ${count}`}
                  >
                    {distributions.churnRisk.map((d, i) => (
                      <Cell key={i} fill={churnRiskColors[d.segment] || COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>

          <Col span={8}>
            <Card title="依从率分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={distributions.compliance.map((d) => ({
                      ...d,
                      label: complianceLabels[d.segment] || d.segment,
                    }))}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ label, count }: any) => `${label}: ${count}`}
                  >
                    {distributions.compliance.map((d, i) => (
                      <Cell key={i} fill={complianceColors[d.segment] || COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>

          <Col span={8}>
            <Card title="活动等级分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={distributions.activityLevel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="activityLevel" type="category" width={100} />
                  <Tooltip />
                  <Bar dataKey="count" name="用户数" fill="#722ed1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        </Row>
      </>
    );
  };

  const isLoading = growthLoading || distLoading || activeLoading;

  return (
    <div>
      {/* 筛选控制 */}
      <Card style={{ marginBottom: 16 }}>
        <Space size="large">
          <span>画像统计范围:</span>
          <Segmented
            value={distributionDays}
            onChange={(val) => setDistributionDays(val as number)}
            options={[
              { label: '30天内注册', value: 30 },
              { label: '90天内注册', value: 90 },
              { label: '180天内注册', value: 180 },
              { label: '全部', value: 3650 },
            ]}
          />
        </Space>
      </Card>

      <Spin spinning={isLoading}>
        {activeData || growthData || distData ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 活跃指标卡 */}
            {renderActiveCards()}

            {/* 运营健康度 + 雷达 + 洞察 */}
            {renderHealthScore()}

            {/* 日活趋势 */}
            {renderDailyActiveTrend()}

            {/* 增长趋势 + 渠道构成 */}
            {renderGrowthTrend()}

            {/* 画像分布 */}
            {renderDistributions()}
          </Space>
        ) : (
          !isLoading && <Empty description="暂无数据" />
        )}
      </Spin>
    </div>
  );
};

export default UserProfileDashboardPage;
