import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Select, Space, Spin, Empty, Tag, Table, Segmented } from 'antd';
import {
  DashboardOutlined,
  LikeOutlined,
  SwapOutlined,
  StopOutlined,
  UserOutlined,
  BarChartOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useQualityDashboard,
  type QualityOverview,
  type AcceptanceByDimension,
  type DailyTrend,
  type PlanCoverage,
} from '@/services/recommendDebugService';

export const routeConfig = {
  name: 'recommend-quality',
  title: '质量仪表盘',
  icon: 'DashboardOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 子组件 ====================

/** 概览指标卡 */
const OverviewCards: React.FC<{ data: QualityOverview }> = ({ data }) => (
  <Row gutter={[16, 16]}>
    <Col span={4}>
      <Card size="small">
        <Statistic title="总反馈数" value={data.totalFeedbacks} prefix={<BarChartOutlined />} />
      </Card>
    </Col>
    <Col span={4}>
      <Card size="small">
        <Statistic
          title="接受率"
          value={data.acceptanceRate}
          suffix="%"
          precision={1}
          prefix={<LikeOutlined />}
          valueStyle={{ color: data.acceptanceRate >= 60 ? '#52c41a' : '#faad14' }}
        />
      </Card>
    </Col>
    <Col span={4}>
      <Card size="small">
        <Statistic
          title="替换率"
          value={data.replacementRate}
          suffix="%"
          precision={1}
          prefix={<SwapOutlined />}
          valueStyle={{ color: data.replacementRate <= 20 ? '#52c41a' : '#ff4d4f' }}
        />
      </Card>
    </Col>
    <Col span={4}>
      <Card size="small">
        <Statistic
          title="跳过率"
          value={data.skipRate}
          suffix="%"
          precision={1}
          prefix={<StopOutlined />}
          valueStyle={{ color: data.skipRate <= 15 ? '#52c41a' : '#ff4d4f' }}
        />
      </Card>
    </Col>
    <Col span={4}>
      <Card size="small">
        <Statistic title="活跃用户数" value={data.activeUsers} prefix={<UserOutlined />} />
      </Card>
    </Col>
    <Col span={4}>
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
);

/** 按维度接受率 */
const AcceptanceChart: React.FC<{
  title: string;
  data: AcceptanceByDimension[];
}> = ({ title, data }) => {
  const chartData = data.map((d) => ({
    ...d,
    ratePercent: d.rate * 100,
  }));

  const columns: ColumnsType<AcceptanceByDimension> = [
    { title: '维度', dataIndex: 'dimension', width: 120 },
    {
      title: '总数',
      dataIndex: 'total',
      width: 80,
      sorter: (a, b) => a.total - b.total,
    },
    {
      title: '接受数',
      dataIndex: 'accepted',
      width: 80,
    },
    {
      title: '接受率',
      dataIndex: 'rate',
      width: 100,
      sorter: (a, b) => a.rate - b.rate,
      render: (rate: number) => (
        <Tag color={rate >= 0.6 ? 'success' : rate >= 0.4 ? 'warning' : 'error'}>
          {(rate * 100).toFixed(1)}%
        </Tag>
      ),
    },
  ];

  return (
    <Card title={title} size="small">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dimension" />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
          <Bar dataKey="ratePercent" name="接受率" fill="#1677ff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <Table
        columns={columns}
        dataSource={data}
        rowKey="dimension"
        size="small"
        pagination={false}
        style={{ marginTop: 12 }}
      />
    </Card>
  );
};

/** 日趋势图 */
const TrendChart: React.FC<{ data: DailyTrend[] }> = ({ data }) => {
  const trendColumns: ColumnsType<DailyTrend> = [
    { title: '日期', dataIndex: 'date', width: 120 },
    { title: '总数', dataIndex: 'total', width: 80 },
    { title: '接受', dataIndex: 'accepted', width: 80 },
    { title: '替换', dataIndex: 'replaced', width: 80 },
    { title: '跳过', dataIndex: 'skipped', width: 80 },
    {
      title: '接受率',
      dataIndex: 'acceptanceRate',
      width: 100,
      render: (val: number) => (
        <Tag color={val >= 60 ? 'success' : val >= 40 ? 'warning' : 'error'}>{val}%</Tag>
      ),
    },
  ];

  return (
    <Card title="日趋势" size="small">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey="accepted"
            name="接受"
            stroke="#52c41a"
            fill="#52c41a"
            fillOpacity={0.15}
            stackId="1"
          />
          <Area
            type="monotone"
            dataKey="replaced"
            name="替换"
            stroke="#faad14"
            fill="#faad14"
            fillOpacity={0.15}
            stackId="1"
          />
          <Area
            type="monotone"
            dataKey="skipped"
            name="跳过"
            stroke="#ff4d4f"
            fill="#ff4d4f"
            fillOpacity={0.15}
            stackId="1"
          />
        </AreaChart>
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

/** 计划覆盖 */
const PlanCoverageCard: React.FC<{ data: PlanCoverage }> = ({ data }) => (
  <Card title="计划覆盖" size="small">
    <Row gutter={16}>
      <Col span={6}>
        <Statistic title="总计划数" value={data.totalPlans} />
      </Col>
      <Col span={6}>
        <Statistic title="调整计划数" value={data.adjustedPlans} />
      </Col>
      <Col span={6}>
        <Statistic title="平均计划热量" value={data.avgPlanCalories} suffix="kcal" precision={0} />
      </Col>
      <Col span={6}>
        <Statistic title="独立用户数" value={data.uniqueUsers} />
      </Col>
    </Row>
    <div style={{ marginTop: 12, color: '#999', fontSize: 12 }}>
      统计范围: {data.dateRange.from} ~ {data.dateRange.to}
    </div>
  </Card>
);

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
            {/* 概览指标 */}
            <OverviewCards data={dashboard.overview} />

            {/* 按维度分析 */}
            <Row gutter={16}>
              <Col span={12}>
                <AcceptanceChart title="按目标类型接受率" data={dashboard.byGoal} />
              </Col>
              <Col span={12}>
                <AcceptanceChart title="按餐次接受率" data={dashboard.byMeal} />
              </Col>
            </Row>

            {/* 日趋势 */}
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
