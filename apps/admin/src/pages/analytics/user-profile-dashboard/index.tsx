import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Space,
  Spin,
  Empty,
  Tag,
  Table,
  Segmented,
  Progress,
} from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  RiseOutlined,
  AlertOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  HeartOutlined,
  DashboardOutlined,
  FireOutlined,
  LineChartOutlined,
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

  // ==================== 活跃指标卡 ====================

  const renderActiveCards = () => {
    if (!activeData) return null;
    return (
      <Row gutter={[16, 16]}>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="DAU (今日)"
              value={activeData.dau}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="WAU (7日)"
              value={activeData.wau}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="MAU (30日)"
              value={activeData.mau}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="总用户数" value={activeData.totalUsers} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
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
        <Col span={4}>
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

  // ==================== 增长趋势 ====================

  const renderGrowthTrend = () => {
    if (!growthData) return null;
    return (
      <Card
        title={
          <Space>
            <RiseOutlined />
            <span>
              用户增长趋势（近 {growthDays} 天新增 {growthData.periodNewUsers} 人，累计{' '}
              {growthData.totalUsers} 人）
            </span>
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
          <AreaChart data={growthData.trend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="count"
              name="新增"
              stroke="#1677ff"
              fill="#1677ff"
              fillOpacity={0.15}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="cumulative"
              name="累计"
              stroke="#52c41a"
              fill="#52c41a"
              fillOpacity={0.1}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
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

        {/* 饼图分布 */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {/* 注册渠道分布 */}
          <Col span={8}>
            <Card title="注册渠道分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={distributions.authType}
                    dataKey="count"
                    nameKey="authType"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ authType, count }) => `${authType}: ${count}`}
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

          {/* 目标类型分布 */}
          <Col span={8}>
            <Card title="目标类型分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={distributions.goal} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="goal" type="category" width={100} />
                  <Tooltip />
                  <Bar dataKey="count" name="用户数" fill="#1677ff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>

          {/* 性别分布 */}
          <Col span={8}>
            <Card title="性别分布" size="small">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={distributions.gender}
                    dataKey="count"
                    nameKey="gender"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ gender, count }) => `${gender}: ${count}`}
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

        {/* 风险 & 依从率分布 */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {/* 流失风险分段 */}
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
                    label={({ label, count }) => `${label}: ${count}`}
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

          {/* 依从率分段 */}
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
                    label={({ label, count }) => `${label}: ${count}`}
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

          {/* 活动等级分布 */}
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

            {/* 日活趋势 */}
            {renderDailyActiveTrend()}

            {/* 增长趋势 */}
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
