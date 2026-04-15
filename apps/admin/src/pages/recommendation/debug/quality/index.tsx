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
  Alert,
  Typography,
} from 'antd';
import {
  LikeOutlined,
  SwapOutlined,
  StopOutlined,
  UserOutlined,
  BarChartOutlined,
  LineChartOutlined,
  WarningOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import {
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useQualityDashboard,
  type QualityOverview,
  type AcceptanceByDimension,
  type DailyTrend,
  type PlanCoverage,
} from '@/services/recommendDebugService';

const { Text } = Typography;

export const routeConfig = {
  name: 'recommend-quality',
  title: '质量仪表盘',
  icon: 'DashboardOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const ACCEPTANCE_WARN_THRESHOLD = 50;
const ACCEPTANCE_DANGER_THRESHOLD = 40;
const SKIP_WARN_THRESHOLD = 20;

const goalLabels: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '健康',
  habit: '习惯养成',
};

const mealLabels: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

// ==================== 工具 ====================

const rateColor = (rate: number): string => {
  if (rate >= 60) return '#52c41a';
  if (rate >= 50) return '#faad14';
  return '#ff4d4f';
};

const pctColor = (rate: number, isInverse = false): string => {
  if (isInverse) {
    if (rate <= 15) return '#52c41a';
    if (rate <= 25) return '#faad14';
    return '#ff4d4f';
  }
  return rateColor(rate);
};

// ==================== 子组件 ====================

/** 概览指标卡 - 增强版 */
const OverviewCards: React.FC<{ data: QualityOverview }> = ({ data }) => {
  const acceptanceOk = data.acceptanceRate >= ACCEPTANCE_WARN_THRESHOLD;
  const skipOk = data.skipRate <= SKIP_WARN_THRESHOLD;

  return (
    <>
      {/* 告警检查 */}
      {(!acceptanceOk || !skipOk) && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message="推荐质量告警"
          description={
            <Space direction="vertical" size={2}>
              {!acceptanceOk && (
                <Text>
                  接受率{' '}
                  <Text strong style={{ color: '#ff4d4f' }}>
                    {data.acceptanceRate}%
                  </Text>{' '}
                  低于阈值 {ACCEPTANCE_WARN_THRESHOLD}%，建议检查推荐策略和评分配置
                </Text>
              )}
              {!skipOk && (
                <Text>
                  跳过率{' '}
                  <Text strong style={{ color: '#ff4d4f' }}>
                    {data.skipRate}%
                  </Text>{' '}
                  超过阈值 {SKIP_WARN_THRESHOLD}%，用户可能对推荐不满意
                </Text>
              )}
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="总反馈数" value={data.totalFeedbacks} prefix={<BarChartOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="接受率"
              value={data.acceptanceRate}
              suffix="%"
              precision={1}
              prefix={<LikeOutlined />}
              valueStyle={{ color: rateColor(data.acceptanceRate) }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="替换率"
              value={data.replacementRate}
              suffix="%"
              precision={1}
              prefix={<SwapOutlined />}
              valueStyle={{ color: pctColor(data.replacementRate, true) }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="跳过率"
              value={data.skipRate}
              suffix="%"
              precision={1}
              prefix={<StopOutlined />}
              valueStyle={{ color: pctColor(data.skipRate, true) }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="活跃用户数" value={data.activeUsers} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="日均反馈数"
              value={data.avgDailyFeedbacks}
              precision={1}
              prefix={<LineChartOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
};

/** 按维度接受率 - 增强版 */
const AcceptanceChart: React.FC<{
  title: string;
  data: AcceptanceByDimension[];
  labelMap?: Record<string, string>;
}> = ({ title, data, labelMap }) => {
  const chartData = data.map((d) => ({
    ...d,
    displayName: labelMap?.[d.dimension] || d.dimension,
    ratePercent: d.rate * 100,
  }));

  const columns: ColumnsType<(typeof chartData)[0]> = [
    {
      title: '维度',
      dataIndex: 'displayName',
      width: 100,
    },
    {
      title: '总数',
      dataIndex: 'total',
      width: 70,
      sorter: (a, b) => a.total - b.total,
    },
    {
      title: '接受数',
      dataIndex: 'accepted',
      width: 70,
    },
    {
      title: '接受率',
      key: 'rate',
      width: 100,
      sorter: (a, b) => a.rate - b.rate,
      render: (_, record) => (
        <Tag color={record.rate >= 0.6 ? 'success' : record.rate >= 0.4 ? 'warning' : 'error'}>
          {(record.rate * 100).toFixed(1)}%
        </Tag>
      ),
    },
  ];

  return (
    <Card title={title} size="small">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="displayName" />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <RechartsTooltip formatter={((value: number) => `${value.toFixed(1)}%`) as any} />
          <ReferenceLine
            y={ACCEPTANCE_WARN_THRESHOLD}
            stroke="#faad14"
            strokeDasharray="5 5"
            label="警戒"
          />
          <ReferenceLine
            y={ACCEPTANCE_DANGER_THRESHOLD}
            stroke="#ff4d4f"
            strokeDasharray="5 5"
            label="危险"
          />
          <Bar dataKey="ratePercent" name="接受率" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={rateColor(entry.ratePercent)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <Table
        columns={columns}
        dataSource={chartData}
        rowKey="dimension"
        size="small"
        pagination={false}
        style={{ marginTop: 12 }}
      />
    </Card>
  );
};

/** 日趋势图 - 增强版：添加接受率折线 + 阈值参考线 */
const TrendChart: React.FC<{ data: DailyTrend[] }> = ({ data }) => {
  // 计算趋势方向
  const recentRate =
    data.length >= 3 ? data.slice(-3).reduce((s, d) => s + d.acceptanceRate, 0) / 3 : 0;
  const earlyRate =
    data.length >= 6 ? data.slice(0, 3).reduce((s, d) => s + d.acceptanceRate, 0) / 3 : 0;
  const trendUp = recentRate > earlyRate;

  const trendColumns: ColumnsType<DailyTrend> = [
    { title: '日期', dataIndex: 'date', width: 110 },
    { title: '总数', dataIndex: 'total', width: 70 },
    {
      title: '接受',
      dataIndex: 'accepted',
      width: 70,
      render: (val) => <Text style={{ color: '#52c41a' }}>{val}</Text>,
    },
    {
      title: '替换',
      dataIndex: 'replaced',
      width: 70,
      render: (val) => <Text style={{ color: '#faad14' }}>{val}</Text>,
    },
    {
      title: '跳过',
      dataIndex: 'skipped',
      width: 70,
      render: (val) => <Text style={{ color: '#ff4d4f' }}>{val}</Text>,
    },
    {
      title: '接受率',
      dataIndex: 'acceptanceRate',
      width: 100,
      sorter: (a, b) => a.acceptanceRate - b.acceptanceRate,
      render: (val: number) => (
        <Tag color={val >= 60 ? 'success' : val >= 40 ? 'warning' : 'error'}>{val}%</Tag>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <span>日趋势</span>
          {data.length >= 6 && (
            <Tag
              color={trendUp ? 'success' : 'error'}
              icon={trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            >
              {trendUp ? '上升' : '下降'}趋势 ({earlyRate.toFixed(1)}% → {recentRate.toFixed(1)}%)
            </Tag>
          )}
        </Space>
      }
      size="small"
    >
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis
            yAxisId="left"
            label={{ value: '数量', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            label={{ value: '接受率', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
          />
          <RechartsTooltip />
          <Legend />
          <ReferenceLine
            yAxisId="right"
            y={ACCEPTANCE_WARN_THRESHOLD}
            stroke="#faad14"
            strokeDasharray="5 5"
          />
          <ReferenceLine
            yAxisId="right"
            y={ACCEPTANCE_DANGER_THRESHOLD}
            stroke="#ff4d4f"
            strokeDasharray="5 5"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="accepted"
            name="接受"
            stroke="#52c41a"
            fill="#52c41a"
            fillOpacity={0.15}
            stackId="1"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="replaced"
            name="替换"
            stroke="#faad14"
            fill="#faad14"
            fillOpacity={0.15}
            stackId="1"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="skipped"
            name="跳过"
            stroke="#ff4d4f"
            fill="#ff4d4f"
            fillOpacity={0.15}
            stackId="1"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="acceptanceRate"
            name="接受率(%)"
            stroke="#1677ff"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Table
        columns={trendColumns}
        dataSource={data}
        rowKey="date"
        size="small"
        pagination={{ pageSize: 10, showSizeChanger: true }}
        style={{ marginTop: 12 }}
      />
    </Card>
  );
};

/** 目标x餐次 交叉热力图 */
const CrossTabHeatmap: React.FC<{
  byGoal: AcceptanceByDimension[];
  byMeal: AcceptanceByDimension[];
}> = ({ byGoal, byMeal }) => {
  // Build a synthetic heatmap from available data
  // Since the API gives us separate dimensions, we show them side-by-side as a pseudo-heatmap

  // Create comparison data
  const allDimensions = [
    ...byGoal.map((g) => ({
      dimension: goalLabels[g.dimension] || g.dimension,
      category: '目标类型',
      total: g.total,
      accepted: g.accepted,
      rate: g.rate * 100,
    })),
    ...byMeal.map((m) => ({
      dimension: mealLabels[m.dimension] || m.dimension,
      category: '餐次类型',
      total: m.total,
      accepted: m.accepted,
      rate: m.rate * 100,
    })),
  ];

  const columns: ColumnsType<(typeof allDimensions)[0]> = [
    { title: '分类', dataIndex: 'category', width: 90 },
    { title: '维度', dataIndex: 'dimension', width: 100 },
    { title: '总数', dataIndex: 'total', width: 70, sorter: (a, b) => a.total - b.total },
    { title: '接受数', dataIndex: 'accepted', width: 70 },
    {
      title: '接受率',
      dataIndex: 'rate',
      width: 120,
      sorter: (a, b) => a.rate - b.rate,
      defaultSortOrder: 'descend',
      render: (val: number) => {
        const bg =
          val >= 60
            ? 'rgba(82,196,26,0.15)'
            : val >= 50
              ? 'rgba(250,173,20,0.15)'
              : 'rgba(255,77,79,0.15)';
        return (
          <div
            style={{
              background: bg,
              padding: '2px 8px',
              borderRadius: 4,
              display: 'inline-block',
              fontWeight: 600,
              color: rateColor(val),
            }}
          >
            {val.toFixed(1)}%
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_, record) => {
        if (record.rate >= 60) return <Tag color="success">健康</Tag>;
        if (record.rate >= ACCEPTANCE_WARN_THRESHOLD) return <Tag color="warning">关注</Tag>;
        return <Tag color="error">告警</Tag>;
      },
    },
  ];

  return (
    <Card title="目标x餐次 接受率对比" size="small">
      <Row gutter={16}>
        <Col span={24}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={allDimensions} layout="vertical" margin={{ left: 80, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="dimension" tick={{ fontSize: 11 }} width={80} />
              <RechartsTooltip formatter={((v: number) => `${v.toFixed(1)}%`) as any} />
              <ReferenceLine x={ACCEPTANCE_WARN_THRESHOLD} stroke="#faad14" strokeDasharray="5 5" />
              <Bar dataKey="rate" name="接受率" radius={[0, 4, 4, 0]}>
                {allDimensions.map((entry, index) => (
                  <Cell key={index} fill={rateColor(entry.rate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Col>
      </Row>
      <Table
        columns={columns}
        dataSource={allDimensions}
        rowKey={(r) => `${r.category}-${r.dimension}`}
        size="small"
        pagination={false}
        style={{ marginTop: 12 }}
      />
    </Card>
  );
};

/** 计划覆盖 */
const PlanCoverageCard: React.FC<{ data: PlanCoverage }> = ({ data }) => {
  const adjustRate =
    data.totalPlans > 0 ? ((data.adjustedPlans / data.totalPlans) * 100).toFixed(1) : '0';

  return (
    <Card title="计划覆盖" size="small">
      <Row gutter={16}>
        <Col xs={12} sm={6}>
          <Statistic title="总计划数" value={data.totalPlans} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="调整计划数"
            value={data.adjustedPlans}
            suffix={
              <Text type="secondary" style={{ fontSize: 12 }}>
                ({adjustRate}%)
              </Text>
            }
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="平均计划热量"
            value={data.avgPlanCalories}
            suffix="kcal"
            precision={0}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="独立用户数" value={data.uniqueUsers} />
        </Col>
      </Row>
      <div style={{ marginTop: 12, color: '#999', fontSize: 12 }}>
        统计范围: {data.dateRange.from} ~ {data.dateRange.to}
      </div>
    </Card>
  );
};

// ==================== 主组件 ====================

const QualityDashboardPage: React.FC = () => {
  const [days, setDays] = useState<number>(30);

  const { data: dashboard, isLoading } = useQualityDashboard(days);

  return (
    <div>
      {/* 筛选栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space size="large">
          <Space>
            <span>回溯天数:</span>
            <Segmented
              value={days}
              onChange={(val) => setDays(val as number)}
              options={[
                { label: '7 天', value: 7 },
                { label: '14 天', value: 14 },
                { label: '30 天', value: 30 },
                { label: '60 天', value: 60 },
                { label: '90 天', value: 90 },
              ]}
            />
          </Space>
        </Space>
      </Card>

      <Spin spinning={isLoading}>
        {dashboard ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 概览指标 + 告警 */}
            <OverviewCards data={dashboard.overview} />

            {/* 按维度分析 */}
            <Row gutter={16}>
              <Col span={12}>
                <AcceptanceChart
                  title="按目标类型接受率"
                  data={dashboard.byGoal}
                  labelMap={goalLabels}
                />
              </Col>
              <Col span={12}>
                <AcceptanceChart
                  title="按餐次接受率"
                  data={dashboard.byMeal}
                  labelMap={mealLabels}
                />
              </Col>
            </Row>

            {/* 目标x餐次 交叉对比 */}
            <CrossTabHeatmap byGoal={dashboard.byGoal} byMeal={dashboard.byMeal} />

            {/* 日趋势（含接受率折线+阈值线+趋势标签） */}
            <TrendChart data={dashboard.trend} />

            {/* 计划覆盖 */}
            <PlanCoverageCard data={dashboard.planCoverage} />
          </Space>
        ) : (
          !isLoading && <Empty description="暂无数据" />
        )}
      </Spin>
    </div>
  );
};

export default QualityDashboardPage;
