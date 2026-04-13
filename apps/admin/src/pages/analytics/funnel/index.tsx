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
  Alert,
  Typography,
  Tooltip,
  Progress,
  Divider,
} from 'antd';
import {
  FunnelPlotOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  UserAddOutlined,
  ExperimentOutlined,
  CreditCardOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  FallOutlined,
} from '@ant-design/icons';
import {
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  ReferenceLine,
  Cell,
  BarChart,
} from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import {
  useConversionFunnel,
  useConversionTrend,
  type FunnelStep,
  type ConversionTrendItem,
  type GetConversionFunnelQuery,
  type GetConversionTrendQuery,
} from '@/services/conversionFunnelService';

const { RangePicker } = DatePicker;
const { Text } = Typography;

export const routeConfig = {
  name: 'analytics-funnel',
  title: '转化漏斗',
  icon: 'FunnelPlotOutlined',
  order: 2,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const DROPOFF_WARN = 60; // 流失率 > 60% 告警
const CONVERSION_WARN = 3; // 整体转化率 < 3% 告警

const stepConfig: Record<number, { icon: React.ReactNode; color: string }> = {
  1: { icon: <UserAddOutlined />, color: '#1677ff' },
  2: { icon: <ExperimentOutlined />, color: '#52c41a' },
  3: { icon: <ThunderboltOutlined />, color: '#faad14' },
  4: { icon: <CreditCardOutlined />, color: '#eb2f96' },
  5: { icon: <CheckCircleOutlined />, color: '#722ed1' },
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

  const funnelParams: GetConversionFunnelQuery = useMemo(
    () => ({
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
      authType: authType || undefined,
      triggerScene: triggerScene || undefined,
    }),
    [dateRange, authType, triggerScene]
  );

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

  // ==================== 计算衍生指标 ====================

  // 最大流失步骤
  const worstDropoff = useMemo(() => {
    if (!funnelData?.funnelSteps?.length) return null;
    const steps = funnelData.funnelSteps.filter((s) => s.step > 1);
    if (!steps.length) return null;
    return steps.reduce((worst, s) => (s.dropoffRate > worst.dropoffRate ? s : worst));
  }, [funnelData]);

  // 趋势方向（近 7 天 vs 前 7 天）
  const trendDirection = useMemo(() => {
    if (!trendData?.trend?.length || trendData.trend.length < 6) return null;
    const items = trendData.trend;
    const mid = Math.floor(items.length / 2);
    const recent = items.slice(mid);
    const earlier = items.slice(0, mid);

    const recentAvg = recent.reduce((s, t) => s + t.conversionRate, 0) / recent.length;
    const earlierAvg = earlier.reduce((s, t) => s + t.conversionRate, 0) / earlier.length;

    return {
      recentAvg,
      earlierAvg,
      change: recentAvg - earlierAvg,
      improving: recentAvg > earlierAvg,
    };
  }, [trendData]);

  // 告警列表
  const alerts = useMemo(() => {
    const items: { type: 'warning' | 'error'; message: string }[] = [];
    if (!funnelData) return items;

    if (funnelData.summary.overallConversionRate < CONVERSION_WARN) {
      items.push({
        type: 'error',
        message: `整体转化率仅 ${funnelData.summary.overallConversionRate.toFixed(2)}%，低于 ${CONVERSION_WARN}% 警戒线`,
      });
    }

    if (worstDropoff && worstDropoff.dropoffRate > DROPOFF_WARN) {
      items.push({
        type: 'warning',
        message: `"${worstDropoff.name}" 步骤流失率高达 ${worstDropoff.dropoffRate}%，是最大瓶颈，建议重点优化`,
      });
    }

    if (trendDirection && !trendDirection.improving && Math.abs(trendDirection.change) > 1) {
      items.push({
        type: 'warning',
        message: `转化率呈下降趋势: 近期均值 ${trendDirection.recentAvg.toFixed(1)}% vs 前期 ${trendDirection.earlierAvg.toFixed(1)}%`,
      });
    }

    return items;
  }, [funnelData, worstDropoff, trendDirection]);

  // ==================== 漏斗条形渲染 ====================

  const renderFunnelBar = (step: FunnelStep, maxCount: number) => {
    const cfg = stepConfig[step.step] || { icon: null, color: '#8c8c8c' };
    const widthPercent = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 8) : 8;
    const isBottleneck = step.step > 1 && step.dropoffRate > DROPOFF_WARN;

    return (
      <div key={step.step} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Space>
            {cfg.icon}
            <span style={{ fontWeight: 500 }}>
              Step {step.step}: {step.name}
            </span>
            {isBottleneck && (
              <Tag color="error" icon={<WarningOutlined />}>
                瓶颈
              </Tag>
            )}
          </Space>
          <Space size="large">
            <span style={{ fontWeight: 600, fontSize: 16 }}>{step.count.toLocaleString()}</span>
            {step.step > 1 && (
              <>
                <Tooltip title={`转化率: 从上一步转化的比例`}>
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
                </Tooltip>
                <Tooltip title={`流失率: 从上一步流失的用户比例`}>
                  <Tag color={step.dropoffRate > DROPOFF_WARN ? 'error' : 'default'}>
                    <FallOutlined /> -{step.dropoffRate}%
                  </Tag>
                </Tooltip>
              </>
            )}
          </Space>
        </div>
        <div
          style={{
            height: 40,
            background: '#f5f5f5',
            borderRadius: 6,
            overflow: 'hidden',
            position: 'relative',
            border: isBottleneck ? '2px solid #ff4d4f' : undefined,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${widthPercent}%`,
              background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}dd)`,
              borderRadius: 6,
              transition: 'width 0.6s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 500 }}>
              总体 {step.overallRate}%
            </span>
            {widthPercent > 20 && (
              <span style={{ color: '#fff', fontSize: 12 }}>{step.count.toLocaleString()} 人</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ==================== 步骤间转化率对比图 ====================

  const stepConversionData = useMemo(() => {
    if (!funnelData?.funnelSteps?.length) return [];
    return funnelData.funnelSteps
      .filter((s) => s.step > 1)
      .map((s) => ({
        name: `${s.name}`,
        转化率: s.conversionRate,
        流失率: s.dropoffRate,
        step: s.step,
      }));
  }, [funnelData]);

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
      width: 120,
      render: (val: number) => (
        <Progress
          percent={val}
          size="small"
          style={{ width: 80 }}
          strokeColor={val >= 30 ? '#52c41a' : val >= 15 ? '#faad14' : '#ff4d4f'}
        />
      ),
    },
    {
      title: '转化率',
      dataIndex: 'conversionRate',
      key: 'conversionRate',
      width: 120,
      sorter: (a: ConversionTrendItem, b: ConversionTrendItem) =>
        a.conversionRate - b.conversionRate,
      render: (val: number) => (
        <Space>
          <Text
            style={{
              color: val >= 5 ? '#52c41a' : val >= 2 ? '#faad14' : '#ff4d4f',
              fontWeight: 600,
            }}
          >
            {val}%
          </Text>
          {val >= 5 && <Tag color="success">优秀</Tag>}
          {val >= 2 && val < 5 && <Tag color="warning">一般</Tag>}
          {val < 2 && <Tag color="error">偏低</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 筛选栏 */}
      <Card size="small">
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

      {/* 健康告警 */}
      {alerts.map((alert, i) => (
        <Alert key={i} message={alert.message} type={alert.type} showIcon closable />
      ))}

      {/* 核心 KPI 卡片行 */}
      {funnelData && (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="注册用户"
                value={funnelData.summary.totalRegistered}
                prefix={<UserAddOutlined style={{ color: '#1677ff' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="付费用户"
                value={funnelData.summary.totalPaid}
                prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="整体转化率"
                value={funnelData.summary.overallConversionRate}
                suffix="%"
                prefix={<FunnelPlotOutlined style={{ color: '#722ed1' }} />}
                precision={2}
                valueStyle={{
                  color: funnelData.summary.overallConversionRate >= 5 ? '#52c41a' : '#faad14',
                }}
              />
              {trendDirection && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <Text type={trendDirection.improving ? 'success' : 'danger'}>
                    {trendDirection.improving ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
                    {Math.abs(trendDirection.change).toFixed(1)}pp
                  </Text>
                  <Text type="secondary"> 趋势</Text>
                </div>
              )}
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="漏斗步骤数"
                value={funnelData.funnelSteps.length}
                prefix={<ExperimentOutlined style={{ color: '#13c2c2' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="最大瓶颈"
                value={worstDropoff ? worstDropoff.name : '-'}
                prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />}
                valueStyle={{ fontSize: 16 }}
              />
              {worstDropoff && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <Text type="danger">流失 {worstDropoff.dropoffRate}%</Text>
                </div>
              )}
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless">
              <Statistic
                title="付费墙触发"
                value={funnelData.funnelSteps.find((s) => s.step === 3)?.count ?? '-'}
                prefix={<CreditCardOutlined style={{ color: '#eb2f96' }} />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 漏斗图 + 步骤转化率对比 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <FunnelPlotOutlined />
                <span>转化漏斗</span>
              </Space>
            }
            size="small"
          >
            <Spin spinning={funnelLoading}>
              {funnelData && funnelData.funnelSteps.length > 0 ? (
                <div style={{ padding: '8px 0' }}>
                  {funnelData.funnelSteps.map((step) =>
                    renderFunnelBar(step, funnelData.funnelSteps[0].count)
                  )}
                </div>
              ) : (
                !funnelLoading && <Empty description="暂无数据" />
              )}
            </Spin>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="步骤间转化 & 流失" size="small">
            {stepConversionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stepConversionData}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis unit="%" tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v) => `${v}%`} />
                  <Legend iconSize={10} />
                  <ReferenceLine
                    y={DROPOFF_WARN}
                    stroke="#ff4d4f"
                    strokeDasharray="5 5"
                    label={{ value: '流失警戒', fill: '#ff4d4f', fontSize: 10 }}
                  />
                  <Bar dataKey="转化率" radius={[4, 4, 0, 0]}>
                    {stepConversionData.map((item, i) => (
                      <Cell
                        key={i}
                        fill={
                          item.转化率 >= 50 ? '#52c41a' : item.转化率 >= 20 ? '#faad14' : '#ff4d4f'
                        }
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="流失率" fill="#ff4d4f" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 转化趋势 - 双 Y 轴 */}
      <Card
        title="转化趋势"
        extra={
          <Space>
            {trendDirection && (
              <Tag
                color={trendDirection.improving ? 'success' : 'error'}
                icon={trendDirection.improving ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              >
                {trendDirection.improving ? '上升' : '下降'}{' '}
                {Math.abs(trendDirection.change).toFixed(1)}pp
              </Tag>
            )}
            <Segmented
              value={granularity}
              onChange={(val) => setGranularity(val as typeof granularity)}
              options={[
                { label: '按日', value: 'day' },
                { label: '按周', value: 'week' },
                { label: '按月', value: 'month' },
              ]}
            />
          </Space>
        }
        size="small"
      >
        <Spin spinning={trendLoading}>
          {trendData && trendData.trend.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={trendData.trend}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Legend />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="registered"
                    name="注册"
                    stroke="#1677ff"
                    fill="#1677ff"
                    fillOpacity={0.1}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="triggered"
                    name="触发付费墙"
                    stroke="#faad14"
                    fill="#faad14"
                    fillOpacity={0.1}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="paid"
                    name="支付成功"
                    stroke="#52c41a"
                    fill="#52c41a"
                    fillOpacity={0.15}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="conversionRate"
                    name="转化率%"
                    stroke="#722ed1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="triggerRate"
                    name="触发率%"
                    stroke="#eb2f96"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 2 }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={5}
                    stroke="#52c41a"
                    strokeDasharray="5 5"
                    label={{ value: '目标5%', fill: '#52c41a', fontSize: 10 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              <Divider />

              <Table
                columns={trendColumns}
                dataSource={trendData.trend}
                rowKey="date"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: true }}
              />
            </>
          ) : (
            !trendLoading && <Empty description="暂无数据" />
          )}
        </Spin>
      </Card>
    </Space>
  );
};

export default ConversionFunnelPage;
