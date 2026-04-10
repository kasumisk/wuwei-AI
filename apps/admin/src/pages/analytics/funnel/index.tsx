import React, { useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  DatePicker,
  Select,
  Statistic,
  Space,
  Spin,
  Empty,
  Tag,
  Table,
  Segmented,
} from 'antd';
import {
  FunnelPlotOutlined,
  ArrowDownOutlined,
  UserAddOutlined,
  ExperimentOutlined,
  CreditCardOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import {
  useConversionFunnel,
  useConversionTrend,
  type FunnelStep,
  type GetConversionFunnelQuery,
  type GetConversionTrendQuery,
} from '@/services/conversionFunnelService';

const { RangePicker } = DatePicker;

export const routeConfig = {
  name: 'analytics-funnel',
  title: '转化漏斗',
  icon: 'FunnelPlotOutlined',
  order: 2,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 漏斗步骤配置 ====================

const stepConfig: Record<number, { icon: React.ReactNode; color: string; barColor: string }> = {
  1: { icon: <UserAddOutlined />, color: '#1677ff', barColor: '#1677ff' },
  2: { icon: <ExperimentOutlined />, color: '#52c41a', barColor: '#52c41a' },
  3: { icon: <ThunderboltOutlined />, color: '#faad14', barColor: '#faad14' },
  4: { icon: <CreditCardOutlined />, color: '#eb2f96', barColor: '#eb2f96' },
  5: { icon: <CheckCircleOutlined />, color: '#722ed1', barColor: '#722ed1' },
};

// ==================== 主组件 ====================

const ConversionFunnelPage: React.FC = () => {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const [authType, setAuthType] = useState<string>('');
  const [triggerScene, setTriggerScene] = useState<string>('');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');

  // 漏斗查询参数
  const funnelParams: GetConversionFunnelQuery = useMemo(
    () => ({
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
      authType: authType || undefined,
      triggerScene: triggerScene || undefined,
    }),
    [dateRange, authType, triggerScene]
  );

  // 趋势查询参数
  const trendParams: GetConversionTrendQuery = useMemo(
    () => ({
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
      granularity,
    }),
    [dateRange, granularity]
  );

  const { data: funnelData, isLoading: funnelLoading } = useConversionFunnel(funnelParams);
  const { data: trendData, isLoading: trendLoading } = useConversionTrend(trendParams);

  // ==================== 漏斗可视化 ====================

  const renderFunnelBar = (step: FunnelStep, maxCount: number) => {
    const cfg = stepConfig[step.step];
    const widthPercent = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 8) : 8;

    return (
      <div key={step.step} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Space>
            {cfg.icon}
            <span style={{ fontWeight: 500 }}>
              Step {step.step}: {step.name}
            </span>
          </Space>
          <Space size="large">
            <span style={{ fontWeight: 600, fontSize: 16 }}>{step.count.toLocaleString()}</span>
            {step.step > 1 && (
              <Tag
                color={
                  step.conversionRate >= 50
                    ? 'success'
                    : step.conversionRate >= 20
                      ? 'warning'
                      : 'error'
                }
              >
                <ArrowDownOutlined /> {step.conversionRate}%
              </Tag>
            )}
          </Space>
        </div>
        <div
          style={{
            height: 36,
            background: '#f5f5f5',
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${widthPercent}%`,
              background: cfg.barColor,
              borderRadius: 4,
              transition: 'width 0.6s ease',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 12,
            }}
          >
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 500 }}>
              {step.overallRate}%
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ==================== 趋势表格列 ====================

  const trendColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    { title: '注册数', dataIndex: 'registered', key: 'registered', width: 100 },
    { title: '触发付费墙', dataIndex: 'triggered', key: 'triggered', width: 120 },
    { title: '支付成功', dataIndex: 'paid', key: 'paid', width: 100 },
    {
      title: '触发率',
      dataIndex: 'triggerRate',
      key: 'triggerRate',
      width: 100,
      render: (val: number) => <Tag color={val >= 30 ? 'success' : 'default'}>{val}%</Tag>,
    },
    {
      title: '转化率',
      dataIndex: 'conversionRate',
      key: 'conversionRate',
      width: 100,
      render: (val: number) => (
        <Tag color={val >= 5 ? 'success' : val >= 2 ? 'warning' : 'default'}>{val}%</Tag>
      ),
    },
  ];

  return (
    <div>
      {/* 筛选栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Space>
            <span>日期范围:</span>
            <RangePicker
              value={dateRange}
              onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])}
              format="YYYY-MM-DD"
            />
          </Space>
          <Space>
            <span>注册渠道:</span>
            <Select
              style={{ width: 150 }}
              placeholder="全部"
              allowClear
              value={authType || undefined}
              onChange={(val) => setAuthType(val || '')}
              options={[
                { label: '匿名', value: 'anonymous' },
                { label: '微信', value: 'wechat' },
                { label: '微信小程序', value: 'wechat_mini' },
                { label: 'Apple', value: 'apple' },
                { label: 'Google', value: 'google' },
                { label: '邮箱', value: 'email' },
                { label: '手机', value: 'phone' },
              ]}
            />
          </Space>
          <Space>
            <span>触发场景:</span>
            <Select
              style={{ width: 150 }}
              placeholder="全部"
              allowClear
              value={triggerScene || undefined}
              onChange={(val) => setTriggerScene(val || '')}
              options={[
                { label: '配额耗尽', value: 'analysis_limit' },
                { label: '高级结果', value: 'advanced_result' },
                { label: '历史查看', value: 'history_view' },
                { label: '精准升级', value: 'precision_upgrade' },
              ]}
            />
          </Space>
        </Space>
      </Card>

      {/* 总览指标 */}
      {funnelData && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card>
              <Statistic
                title="注册用户数"
                value={funnelData.summary.totalRegistered}
                prefix={<UserAddOutlined />}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic
                title="付费用户数"
                value={funnelData.summary.totalPaid}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic
                title="整体转化率"
                value={funnelData.summary.overallConversionRate}
                suffix="%"
                prefix={<FunnelPlotOutlined />}
                precision={2}
                valueStyle={{
                  color: funnelData.summary.overallConversionRate >= 5 ? '#52c41a' : '#faad14',
                }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 漏斗图 */}
      <Card
        title={
          <Space>
            <FunnelPlotOutlined />
            <span>转化漏斗</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Spin spinning={funnelLoading}>
          {funnelData && funnelData.funnelSteps.length > 0 ? (
            <div style={{ padding: '16px 0' }}>
              {funnelData.funnelSteps.map((step) =>
                renderFunnelBar(step, funnelData.funnelSteps[0].count)
              )}
            </div>
          ) : (
            !funnelLoading && <Empty description="暂无数据" />
          )}
        </Spin>
      </Card>

      {/* 转化趋势 */}
      <Card
        title="转化趋势"
        extra={
          <Segmented
            value={granularity}
            onChange={(val) => setGranularity(val as typeof granularity)}
            options={[
              { label: '按日', value: 'day' },
              { label: '按周', value: 'week' },
              { label: '按月', value: 'month' },
            ]}
          />
        }
        style={{ marginBottom: 16 }}
      >
        <Spin spinning={trendLoading}>
          {trendData && trendData.trend.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendData.trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="registered"
                    name="注册"
                    stroke="#1677ff"
                    fill="#1677ff"
                    fillOpacity={0.15}
                  />
                  <Area
                    type="monotone"
                    dataKey="triggered"
                    name="触发付费墙"
                    stroke="#faad14"
                    fill="#faad14"
                    fillOpacity={0.15}
                  />
                  <Area
                    type="monotone"
                    dataKey="paid"
                    name="支付成功"
                    stroke="#52c41a"
                    fill="#52c41a"
                    fillOpacity={0.15}
                  />
                </AreaChart>
              </ResponsiveContainer>

              <Table
                columns={trendColumns}
                dataSource={trendData.trend}
                rowKey="date"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: true }}
                style={{ marginTop: 16 }}
              />
            </>
          ) : (
            !trendLoading && <Empty description="暂无数据" />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default ConversionFunnelPage;
