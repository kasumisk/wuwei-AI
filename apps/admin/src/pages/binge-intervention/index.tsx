import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Input,
  Button,
  Space,
  Table,
  Typography,
  Alert,
  Select,
  Spin,
  Progress,
  Tooltip,
  Empty,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  SearchOutlined,
  ReloadOutlined,
  UserOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  FireOutlined,
  PlayCircleOutlined,
  RiseOutlined,
  FallOutlined,
} from '@ant-design/icons';
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import {
  useEffectiveness,
  useUserEffectiveness,
  useTriggerEvaluation,
  type InterventionRecord,
  type InterventionEffectivenessStats,
  type UserInterventionOverview,
} from '@/services/bingeInterventionService';
import dayjs from 'dayjs';

const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'binge-intervention',
  title: '暴食干预',
  icon: 'ThunderboltOutlined',
  order: 19,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 主组件 ====================

const BingeInterventionPage: React.FC = () => {
  const [days, setDays] = useState(30);
  const [userId, setUserId] = useState('');
  const [searchUserId, setSearchUserId] = useState('');

  const { data: statsRaw, isLoading, refetch } = useEffectiveness({ days });
  const stats = statsRaw as InterventionEffectivenessStats | undefined;
  const {
    data: userStatsRaw,
    isLoading: userLoading,
    isError: userError,
  } = useUserEffectiveness(searchUserId, { days }, { enabled: !!searchUserId });
  const userStats = userStatsRaw as UserInterventionOverview | undefined;
  const triggerEval = useTriggerEvaluation();

  // 告警系统
  const alerts: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
  if (stats) {
    if (stats.effectiveRate < 0.3 && stats.evaluatedCount > 0)
      alerts.push({
        type: 'error',
        message: `干预有效率仅 ${(stats.effectiveRate * 100).toFixed(1)}%（<30%），干预效果不佳`,
      });
    else if (stats.effectiveRate < 0.5 && stats.evaluatedCount > 0)
      alerts.push({
        type: 'warning',
        message: `干预有效率 ${(stats.effectiveRate * 100).toFixed(1)}%（<50%），需关注干预策略`,
      });
    if (stats.postRecordRate < 0.5 && stats.evaluatedCount > 0)
      alerts.push({
        type: 'warning',
        message: `干预后记录率 ${(stats.postRecordRate * 100).toFixed(1)}%（<50%），较多用户未在干预后记录饮食`,
      });
    const pendingCount = stats.totalInterventions - stats.evaluatedCount;
    if (pendingCount > 10)
      alerts.push({
        type: 'info',
        message: `有 ${pendingCount} 条干预记录待评估，可手动触发评估`,
      });
  }

  // 时段热力柱状图数据
  const hourlyData =
    stats?.hourlyBreakdown.map((h) => ({
      hour: `${h.hour}:00`,
      hourNum: h.hour,
      count: h.count,
      effectiveCount: h.effectiveCount,
      effectiveRate: +(h.effectiveRate * 100).toFixed(1),
    })) ?? [];

  // 高峰时段识别
  const peakHour = hourlyData.reduce((max, h) => (h.count > max.count ? h : max), {
    hour: '-',
    count: 0,
    effectiveRate: 0,
  });

  const handleTriggerEval = async () => {
    try {
      const result = await triggerEval.mutateAsync();
      message.success(`评估完成，处理了 ${result.evaluatedCount} 条记录`);
      refetch();
    } catch {
      message.error('触发评估失败');
    }
  };

  return (
    <div style={{ padding: 0 }}>
      {/* 告警 */}
      {alerts.map((a, i) => (
        <Alert
          key={i}
          type={a.type}
          message={a.message}
          showIcon
          closable
          style={{ marginBottom: 8 }}
        />
      ))}

      {/* 工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Text strong>统计窗口：</Text>
            <Select
              value={days}
              onChange={setDays}
              style={{ width: 100 }}
              options={[
                { label: '7天', value: 7 },
                { label: '14天', value: 14 },
                { label: '30天', value: 30 },
                { label: '60天', value: 60 },
                { label: '90天', value: 90 },
              ]}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Space>
              <Button
                icon={<PlayCircleOutlined />}
                onClick={handleTriggerEval}
                loading={triggerEval.isPending}
                type="primary"
                ghost
              >
                手动评估
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Spin spinning={isLoading}>
        {/* KPI 卡片行 */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="总干预次数"
                value={stats?.totalInterventions ?? '-'}
                prefix={<ThunderboltOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已评估"
                value={stats?.evaluatedCount ?? '-'}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="有效率"
                value={stats ? (stats.effectiveRate * 100).toFixed(1) : '-'}
                suffix="%"
                valueStyle={{
                  color: stats
                    ? stats.effectiveRate >= 0.5
                      ? '#52c41a'
                      : stats.effectiveRate >= 0.3
                        ? '#faad14'
                        : '#f5222d'
                    : undefined,
                }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="记录率"
                value={stats ? (stats.postRecordRate * 100).toFixed(1) : '-'}
                suffix="%"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="平均卡路里减少"
                value={
                  stats?.avgCalorieReduction != null ? stats.avgCalorieReduction.toFixed(0) : '-'
                }
                suffix="kcal"
                valueStyle={{
                  color:
                    stats?.avgCalorieReduction != null && stats.avgCalorieReduction > 0
                      ? '#52c41a'
                      : undefined,
                }}
                prefix={
                  stats?.avgCalorieReduction != null && stats.avgCalorieReduction > 0 ? (
                    <FallOutlined />
                  ) : undefined
                }
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="活跃用户"
                value={stats?.activeUserCount ?? '-'}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>
        </Row>

        {/* 时段分布 + 有效率 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={16}>
            <Card
              title="时段干预分布与有效率"
              size="small"
              extra={
                peakHour.count > 0 ? (
                  <Tag color="orange" icon={<FireOutlined />}>
                    高峰时段: {peakHour.hour}（{peakHour.count}次）
                  </Tag>
                ) : null
              }
            >
              {hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={hourlyData} margin={{ top: 10, right: 30, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="left"
                      label={{ value: '次数', angle: -90, position: 'insideLeft' }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: '有效率', angle: 90, position: 'insideRight' }}
                    />
                    <RechartsTooltip />
                    <ReferenceLine
                      yAxisId="right"
                      y={50}
                      stroke="#52c41a"
                      strokeDasharray="3 3"
                      label="50%目标"
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="count"
                      fill="#1890ff"
                      name="干预次数"
                      barSize={16}
                      opacity={0.7}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="effectiveCount"
                      fill="#52c41a"
                      name="有效次数"
                      barSize={16}
                      opacity={0.7}
                    />
                    <Line
                      yAxisId="right"
                      dataKey="effectiveRate"
                      stroke="#fa8c16"
                      name="有效率(%)"
                      strokeWidth={2}
                      dot
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="暂无时段数据" />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="时段有效率明细" size="small" style={{ height: '100%' }}>
              <Table
                dataSource={hourlyData.filter((h) => h.count > 0)}
                rowKey="hour"
                size="small"
                pagination={false}
                scroll={{ y: 260 }}
                columns={[
                  {
                    title: '时段',
                    dataIndex: 'hour',
                    key: 'hour',
                    width: 60,
                  },
                  {
                    title: '干预数',
                    dataIndex: 'count',
                    key: 'count',
                    width: 60,
                    sorter: (a: (typeof hourlyData)[0], b: (typeof hourlyData)[0]) =>
                      a.count - b.count,
                  },
                  {
                    title: '有效率',
                    dataIndex: 'effectiveRate',
                    key: 'effectiveRate',
                    width: 100,
                    sorter: (a: (typeof hourlyData)[0], b: (typeof hourlyData)[0]) =>
                      a.effectiveRate - b.effectiveRate,
                    render: (val: number) => (
                      <Space>
                        <Progress
                          percent={val}
                          size="small"
                          style={{ width: 50 }}
                          strokeColor={val >= 50 ? '#52c41a' : val >= 30 ? '#faad14' : '#f5222d'}
                          format={() => ''}
                        />
                        <Text style={{ fontSize: 12 }}>{val}%</Text>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Spin>

      {/* 单用户查询 */}
      <Card
        title={
          <Space>
            <UserOutlined />
            <span>单用户干预记录</span>
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Input
              placeholder="输入用户 ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value.trim())}
              onPressEnter={() => setSearchUserId(userId)}
              style={{ width: 280 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={() => setSearchUserId(userId)}
              disabled={!userId}
            >
              查询
            </Button>
          </Space>
        }
      >
        {searchUserId ? (
          <Spin spinning={userLoading}>
            {userError ? (
              <Alert type="error" message="查询失败，请检查用户 ID" showIcon />
            ) : userStats ? (
              <>
                {/* 用户概览 */}
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic title="总干预次数" value={userStats.totalInterventions} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic title="有效次数" value={userStats.effectiveCount} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic
                        title="有效率"
                        value={(userStats.effectiveRate * 100).toFixed(1)}
                        suffix="%"
                        valueStyle={{
                          color:
                            userStats.effectiveRate >= 0.5
                              ? '#52c41a'
                              : userStats.effectiveRate >= 0.3
                                ? '#faad14'
                                : '#f5222d',
                        }}
                      />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic
                        title="干预效果评价"
                        value={
                          userStats.effectiveRate >= 0.6
                            ? '良好'
                            : userStats.effectiveRate >= 0.4
                              ? '一般'
                              : '偏低'
                        }
                        valueStyle={{
                          color:
                            userStats.effectiveRate >= 0.6
                              ? '#52c41a'
                              : userStats.effectiveRate >= 0.4
                                ? '#faad14'
                                : '#f5222d',
                        }}
                      />
                    </Card>
                  </Col>
                </Row>

                {/* 干预记录时间线 + 表格 */}
                <Table
                  dataSource={userStats.recentInterventions}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    {
                      title: '时间',
                      dataIndex: 'createdAt',
                      key: 'createdAt',
                      width: 160,
                      render: (val: string) => (
                        <Text type="secondary">{dayjs(val).format('MM-DD HH:mm')}</Text>
                      ),
                    },
                    {
                      title: '触发时段',
                      dataIndex: 'triggerHour',
                      key: 'triggerHour',
                      width: 80,
                      render: (h: number) => <Tag>{h}:00</Tag>,
                    },
                    {
                      title: '干预消息',
                      dataIndex: 'message',
                      key: 'message',
                      ellipsis: true,
                      render: (msg: string) => (
                        <Tooltip title={msg}>
                          <Text>{msg}</Text>
                        </Tooltip>
                      ),
                    },
                    {
                      title: '干预前卡路里',
                      dataIndex: 'preCalories',
                      key: 'preCalories',
                      width: 110,
                      render: (val: number | null) =>
                        val != null ? `${val.toFixed(0)} kcal` : <Text type="secondary">-</Text>,
                    },
                    {
                      title: '干预后卡路里',
                      dataIndex: 'postCalories',
                      key: 'postCalories',
                      width: 110,
                      render: (val: number | null) =>
                        val != null ? `${val.toFixed(0)} kcal` : <Text type="secondary">-</Text>,
                    },
                    {
                      title: '卡路里变化',
                      key: 'change',
                      width: 120,
                      render: (_: unknown, r: InterventionRecord) => {
                        if (r.preCalories == null || r.postCalories == null)
                          return <Text type="secondary">-</Text>;
                        const diff = r.preCalories - r.postCalories;
                        return (
                          <Text
                            style={{ color: diff > 0 ? '#52c41a' : diff < 0 ? '#f5222d' : '#666' }}
                          >
                            {diff > 0 ? <FallOutlined /> : diff < 0 ? <RiseOutlined /> : null}{' '}
                            {Math.abs(diff).toFixed(0)} kcal
                          </Text>
                        );
                      },
                    },
                    {
                      title: '是否有效',
                      dataIndex: 'effective',
                      key: 'effective',
                      width: 90,
                      render: (val: boolean | null) => {
                        if (val === null)
                          return (
                            <Tag icon={<ClockCircleOutlined />} color="default">
                              待评估
                            </Tag>
                          );
                        return val ? (
                          <Tag icon={<CheckCircleOutlined />} color="success">
                            有效
                          </Tag>
                        ) : (
                          <Tag icon={<CloseCircleOutlined />} color="error">
                            无效
                          </Tag>
                        );
                      },
                    },
                    {
                      title: '后续记录',
                      dataIndex: 'hadPostRecord',
                      key: 'hadPostRecord',
                      width: 80,
                      render: (val: boolean | null) => {
                        if (val === null) return <Text type="secondary">-</Text>;
                        return val ? <Tag color="blue">有</Tag> : <Tag color="default">无</Tag>;
                      },
                    },
                  ]}
                />
              </>
            ) : null}
          </Spin>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
            <ThunderboltOutlined style={{ fontSize: 36, marginBottom: 8 }} />
            <br />
            <Text type="secondary">输入用户 ID 查看其暴食干预记录与效果</Text>
          </div>
        )}
      </Card>
    </div>
  );
};

export default BingeInterventionPage;
