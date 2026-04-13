import React, { useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Space,
  Spin,
  Empty,
  Segmented,
  Input,
  Table,
  Tag,
  Progress,
  Divider,
  Typography,
  Alert,
  Tooltip,
  Badge,
} from 'antd';
import {
  ExperimentOutlined,
  BarChartOutlined,
  GlobalOutlined,
  FieldTimeOutlined,
  CheckCircleOutlined,
  SwapOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ReferenceLine,
  PieChart,
  Pie,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useStrategyReport,
  useChannelAnalysis,
  useExperimentCompare,
  type ChannelEffectivenessResult,
  type ExperimentGroupResult,
} from '@/services/strategyEffectivenessService';

const { Search } = Input;
const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'strategy-effectiveness',
  title: '策略效果',
  icon: 'BarChartOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#13c2c2', '#fa541c'];
const ACCEPT_WARN_THRESHOLD = 0.4;
const ACCEPT_DANGER_THRESHOLD = 0.3;
const DURATION_WARN_THRESHOLD = 500;
const DURATION_DANGER_THRESHOLD = 1000;

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function getHealthTag(acceptanceRate: number) {
  if (acceptanceRate >= 0.5) return <Tag color="success">健康</Tag>;
  if (acceptanceRate >= ACCEPT_WARN_THRESHOLD) return <Tag color="warning">关注</Tag>;
  return <Tag color="error">告警</Tag>;
}

function getDurationTag(ms: number) {
  if (ms <= DURATION_WARN_THRESHOLD) return <Tag color="success">快速</Tag>;
  if (ms <= DURATION_DANGER_THRESHOLD) return <Tag color="warning">偏慢</Tag>;
  return <Tag color="error">超时</Tag>;
}

// ==================== 渠道分析 ====================

const ChannelAnalysisCard: React.FC<{ days: number }> = ({ days }) => {
  const { data, isLoading } = useChannelAnalysis(days);

  // 按接受率排序
  const sortedData = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.acceptanceRate - a.acceptanceRate),
    [data]
  );

  // 找最佳渠道
  const bestChannel = sortedData[0];
  const worstChannel = sortedData.length > 1 ? sortedData[sortedData.length - 1] : null;

  const columns: ColumnsType<ChannelEffectivenessResult> = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_, __, i) => {
        if (i === 0) return <TrophyOutlined style={{ color: '#faad14', fontSize: 16 }} />;
        if (i === 1) return <TrophyOutlined style={{ color: '#bfbfbf', fontSize: 14 }} />;
        return <Text type="secondary">{i + 1}</Text>;
      },
    },
    { title: '渠道', dataIndex: 'channel', width: 100 },
    {
      title: '推荐数',
      dataIndex: 'totalRecommendations',
      sorter: (a, b) => b.totalRecommendations - a.totalRecommendations,
    },
    {
      title: '接受率',
      dataIndex: 'acceptanceRate',
      sorter: (a, b) => b.acceptanceRate - a.acceptanceRate,
      render: (v: number) => (
        <Space>
          <Progress
            percent={Math.round(v * 100)}
            size="small"
            style={{ width: 80 }}
            strokeColor={v >= 0.5 ? '#52c41a' : v >= 0.3 ? '#faad14' : '#ff4d4f'}
          />
          {getHealthTag(v)}
        </Space>
      ),
    },
    {
      title: '替换率',
      dataIndex: 'replacementRate',
      render: (v: number) => pct(v),
    },
    {
      title: '平均候选池',
      dataIndex: 'avgPoolSize',
      render: (v: number) => v.toFixed(1),
    },
    {
      title: '平均耗时',
      dataIndex: 'avgDurationMs',
      render: (v: number) => (
        <Space>
          <span>{v.toFixed(0)}ms</span>
          {getDurationTag(v)}
        </Space>
      ),
    },
  ];

  // 堆叠柱状图
  const barData = sortedData.map((d) => ({
    channel: d.channel,
    接受率: Math.round(d.acceptanceRate * 100),
    替换率: Math.round(d.replacementRate * 100),
    跳过率: Math.round((1 - d.acceptanceRate - d.replacementRate) * 100),
  }));

  // 雷达图
  const radarData = useMemo(() => {
    if (sortedData.length < 2) return [];
    const maxPool = Math.max(...sortedData.map((d) => d.avgPoolSize), 1);
    const maxDur = Math.max(...sortedData.map((d) => d.avgDurationMs), 1);
    const maxRec = Math.max(...sortedData.map((d) => d.totalRecommendations), 1);

    const dims = [
      { key: '接受率', fn: (d: ChannelEffectivenessResult) => d.acceptanceRate * 100 },
      { key: '候选池', fn: (d: ChannelEffectivenessResult) => (d.avgPoolSize / maxPool) * 100 },
      {
        key: '速度',
        fn: (d: ChannelEffectivenessResult) => Math.max(0, (1 - d.avgDurationMs / maxDur) * 100),
      },
      {
        key: '规模',
        fn: (d: ChannelEffectivenessResult) => (d.totalRecommendations / maxRec) * 100,
      },
      { key: '低替换', fn: (d: ChannelEffectivenessResult) => (1 - d.replacementRate) * 100 },
    ];

    return dims.map((dim) => {
      const entry: Record<string, string | number> = { dimension: dim.key };
      sortedData.slice(0, 4).forEach((d) => {
        entry[d.channel] = Math.round(dim.fn(d) * 10) / 10;
      });
      return entry;
    });
  }, [sortedData]);

  return (
    <Card
      title={
        <Space>
          <GlobalOutlined />
          <span>渠道效果分析</span>
          {bestChannel && (
            <Tag color="gold">
              最佳: {bestChannel.channel} ({pct(bestChannel.acceptanceRate)})
            </Tag>
          )}
        </Space>
      }
      size="small"
    >
      <Spin spinning={isLoading}>
        {sortedData.length ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 渠道差异告警 */}
            {bestChannel &&
              worstChannel &&
              bestChannel.acceptanceRate - worstChannel.acceptanceRate > 0.15 && (
                <Alert
                  message={`渠道效果差异较大: ${bestChannel.channel}(${pct(bestChannel.acceptanceRate)}) vs ${worstChannel.channel}(${pct(worstChannel.acceptanceRate)})，差距 ${pct(bestChannel.acceptanceRate - worstChannel.acceptanceRate)}`}
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                />
              )}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={radarData.length > 0 ? 14 : 24}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <RTooltip formatter={(v) => `${v}%`} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={50} stroke="#52c41a" strokeDasharray="5 5" label="目标" />
                    <ReferenceLine y={30} stroke="#ff4d4f" strokeDasharray="5 5" label="警戒" />
                    <Bar dataKey="接受率" fill="#52c41a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="替换率" fill="#faad14" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="跳过率" fill="#ff4d4f" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Col>
              {radarData.length > 0 && (
                <Col xs={24} lg={10}>
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      {sortedData.slice(0, 4).map((d, i) => (
                        <Radar
                          key={d.channel}
                          name={d.channel}
                          dataKey={d.channel}
                          stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]}
                          fillOpacity={0.1}
                        />
                      ))}
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      <RTooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </Col>
              )}
            </Row>

            <Table
              size="small"
              dataSource={sortedData}
              rowKey="channel"
              columns={columns}
              pagination={false}
            />
          </Space>
        ) : (
          !isLoading && <Empty description="暂无渠道数据" />
        )}
      </Spin>
    </Card>
  );
};

// ==================== 实验对比 ====================

const ExperimentCompareCard: React.FC<{ days: number }> = ({ days }) => {
  const [inputId, setInputId] = useState('');
  const [experimentId, setExperimentId] = useState('');

  const { data, isLoading } = useExperimentCompare(experimentId, days);

  // 找出最佳组
  const bestGroup = useMemo(() => {
    if (!data?.groups?.length) return null;
    return data.groups.reduce((best, g) => (g.acceptanceRate > best.acceptanceRate ? g : best));
  }, [data]);

  const columns: ColumnsType<ExperimentGroupResult> = [
    {
      title: '实验组',
      dataIndex: 'groupId',
      render: (v: string) => {
        const isBest = bestGroup?.groupId === v;
        return (
          <Space>
            <Tag color={isBest ? 'gold' : 'blue'}>{v}</Tag>
            {isBest && <TrophyOutlined style={{ color: '#faad14' }} />}
          </Space>
        );
      },
    },
    { title: '反馈数', dataIndex: 'totalFeedbacks' },
    {
      title: '接受率',
      dataIndex: 'acceptanceRate',
      render: (v: number) => (
        <Space>
          <Text style={{ color: v >= 0.5 ? '#52c41a' : v >= 0.3 ? '#faad14' : '#ff4d4f' }}>
            {pct(v)}
          </Text>
          {getHealthTag(v)}
        </Space>
      ),
    },
    { title: '替换率', dataIndex: 'replacementRate', render: (v: number) => pct(v) },
    { title: '跳过率', dataIndex: 'skipRate', render: (v: number) => pct(v) },
    {
      title: '平均耗时',
      dataIndex: 'avgDurationMs',
      render: (v: number) => (
        <Space>
          <span>{v.toFixed(0)}ms</span>
          {getDurationTag(v)}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <ExperimentOutlined />
          <span>A/B 实验效果对比</span>
        </Space>
      }
      size="small"
    >
      <Search
        placeholder="输入 Experiment ID"
        value={inputId}
        onChange={(e) => setInputId(e.target.value)}
        onSearch={(v) => setExperimentId(v.trim())}
        enterButton="查询"
        style={{ maxWidth: 380, marginBottom: 16 }}
        allowClear
      />
      <Spin spinning={isLoading}>
        {data ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">实验 ID: {data.experimentId}</Text>

            {/* 实验组接受率对比告警 */}
            {data.groups.length >= 2 &&
              bestGroup &&
              (() => {
                const sorted = [...data.groups].sort((a, b) => b.acceptanceRate - a.acceptanceRate);
                const lift = sorted[0].acceptanceRate - sorted[sorted.length - 1].acceptanceRate;
                return lift > 0.1 ? (
                  <Alert
                    message={`实验组间接受率差异: ${pct(lift)}，${sorted[0].groupId} 领先`}
                    type={lift > 0.2 ? 'success' : 'info'}
                    showIcon
                  />
                ) : null;
              })()}

            {data.groups.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.groups.map((g) => ({
                    group: g.groupId,
                    接受率: Math.round(g.acceptanceRate * 100),
                    替换率: Math.round(g.replacementRate * 100),
                    跳过率: Math.round(g.skipRate * 100),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <RTooltip formatter={(v) => `${v}%`} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={50} stroke="#52c41a" strokeDasharray="5 5" />
                  <Bar dataKey="接受率" fill="#52c41a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="替换率" fill="#faad14" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="跳过率" fill="#ff4d4f" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <Table
              size="small"
              dataSource={data.groups}
              rowKey="groupId"
              columns={columns}
              pagination={false}
            />
          </Space>
        ) : (
          !isLoading && experimentId && <Empty description="未找到该实验数据" />
        )}
      </Spin>
    </Card>
  );
};

// ==================== 主页面 ====================

const StrategyEffectivenessPage: React.FC = () => {
  const [days, setDays] = useState(7);
  const [strategyId, setStrategyId] = useState<string | undefined>(undefined);
  const [strategyInput, setStrategyInput] = useState('');

  const { data: report, isLoading: reportLoading } = useStrategyReport({ strategyId, days });

  // 同时加载上一个周期做对比
  const { data: prevReport } = useStrategyReport(
    { strategyId, days: days * 2 },
    { staleTime: 5 * 60 * 1000 }
  );

  // 环比变化计算（当前周期 vs 前一个同长周期）
  const trends = useMemo(() => {
    if (!report || !prevReport) return null;
    // prevReport 包含了整个 2x 期间的数据，"上一期" ≈ prevReport - report
    const prevAcceptance =
      prevReport.totalRecommendations > report.totalRecommendations
        ? (prevReport.acceptanceRate * prevReport.totalRecommendations -
            report.acceptanceRate * report.totalRecommendations) /
          Math.max(prevReport.totalRecommendations - report.totalRecommendations, 1)
        : prevReport.acceptanceRate;
    const prevReplacement =
      prevReport.totalRecommendations > report.totalRecommendations
        ? (prevReport.replacementRate * prevReport.totalRecommendations -
            report.replacementRate * report.totalRecommendations) /
          Math.max(prevReport.totalRecommendations - report.totalRecommendations, 1)
        : prevReport.replacementRate;

    return {
      acceptanceChange: report.acceptanceRate - prevAcceptance,
      replacementChange: report.replacementRate - prevReplacement,
      volumeChange:
        prevReport.totalRecommendations > 0
          ? report.totalRecommendations /
              (prevReport.totalRecommendations - report.totalRecommendations) -
            1
          : 0,
    };
  }, [report, prevReport]);

  const goalTypeData = report
    ? Object.entries(report.goalTypeDistribution).map(([goal, count]) => ({ goal, count }))
    : [];

  const channelPieData = report
    ? Object.entries(report.channelDistribution).map(([channel, count]) => ({ channel, count }))
    : [];

  // 全局健康告警
  const alerts = useMemo(() => {
    const items: { type: 'warning' | 'error'; message: string }[] = [];
    if (!report) return items;
    if (report.acceptanceRate < ACCEPT_DANGER_THRESHOLD) {
      items.push({
        type: 'error',
        message: `接受率仅 ${pct(report.acceptanceRate)}，低于危险阈值 ${pct(ACCEPT_DANGER_THRESHOLD)}，需要立即关注`,
      });
    } else if (report.acceptanceRate < ACCEPT_WARN_THRESHOLD) {
      items.push({
        type: 'warning',
        message: `接受率 ${pct(report.acceptanceRate)} 低于警戒线 ${pct(ACCEPT_WARN_THRESHOLD)}，建议优化策略配置`,
      });
    }
    if (report.avgDurationMs > DURATION_DANGER_THRESHOLD) {
      items.push({
        type: 'error',
        message: `平均计算耗时 ${Math.round(report.avgDurationMs)}ms 超过 ${DURATION_DANGER_THRESHOLD}ms，严重影响用户体验`,
      });
    } else if (report.avgDurationMs > DURATION_WARN_THRESHOLD) {
      items.push({
        type: 'warning',
        message: `平均计算耗时 ${Math.round(report.avgDurationMs)}ms 偏高，建议优化`,
      });
    }
    if (report.replacementRate > 0.3) {
      items.push({
        type: 'warning',
        message: `替换率 ${pct(report.replacementRate)} 偏高，说明首次推荐准确度不足`,
      });
    }
    return items;
  }, [report]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 控制栏 */}
      <Card size="small">
        <Space wrap>
          <span>时间范围：</span>
          <Segmented
            value={days}
            onChange={(v) => setDays(v as number)}
            options={[
              { label: '7天', value: 7 },
              { label: '14天', value: 14 },
              { label: '30天', value: 30 },
            ]}
          />
          <Divider type="vertical" />
          <span>策略筛选（可选）：</span>
          <Input.Search
            placeholder="Strategy ID（留空=全局）"
            value={strategyInput}
            onChange={(e) => setStrategyInput(e.target.value)}
            onSearch={(v) => setStrategyId(v.trim() || undefined)}
            allowClear
            style={{ width: 260 }}
          />
        </Space>
      </Card>

      {/* 健康告警 */}
      {alerts.map((alert, i) => (
        <Alert key={i} message={alert.message} type={alert.type} showIcon closable />
      ))}

      {/* 核心 KPI 卡片行 */}
      <Spin spinning={reportLoading}>
        {report && (
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="推荐次数"
                  value={report.totalRecommendations}
                  prefix={<BarChartOutlined style={{ color: '#1677ff' }} />}
                  suffix={
                    trends && !isNaN(trends.volumeChange) && isFinite(trends.volumeChange) ? (
                      <Tooltip title={`环比变化`}>
                        <span
                          style={{
                            fontSize: 12,
                            color: trends.volumeChange >= 0 ? '#52c41a' : '#ff4d4f',
                          }}
                        >
                          {trends.volumeChange >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                          {Math.abs(trends.volumeChange * 100).toFixed(0)}%
                        </span>
                      </Tooltip>
                    ) : undefined
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="接受率"
                  value={(report.acceptanceRate * 100).toFixed(1)}
                  suffix="%"
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{
                    color:
                      report.acceptanceRate >= 0.5
                        ? '#52c41a'
                        : report.acceptanceRate >= 0.3
                          ? '#faad14'
                          : '#ff4d4f',
                  }}
                />
                {trends && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <Text type={trends.acceptanceChange >= 0 ? 'success' : 'danger'}>
                      {trends.acceptanceChange >= 0 ? '+' : ''}
                      {(trends.acceptanceChange * 100).toFixed(1)}pp
                    </Text>
                    <Text type="secondary"> 环比</Text>
                  </div>
                )}
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="替换率"
                  value={(report.replacementRate * 100).toFixed(1)}
                  suffix="%"
                  prefix={<SwapOutlined style={{ color: '#faad14' }} />}
                  valueStyle={{ color: report.replacementRate > 0.3 ? '#faad14' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="跳过率"
                  value={(report.skipRate * 100).toFixed(1)}
                  suffix="%"
                  prefix={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                  valueStyle={{ color: report.skipRate > 0.2 ? '#ff4d4f' : undefined }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="平均计算耗时"
                  value={Math.round(report.avgDurationMs)}
                  suffix="ms"
                  prefix={<FieldTimeOutlined style={{ color: '#722ed1' }} />}
                  valueStyle={{ color: report.avgDurationMs > 500 ? '#ff4d4f' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="平均候选池"
                  value={report.avgPoolSize.toFixed(1)}
                  prefix={<ThunderboltOutlined style={{ color: '#13c2c2' }} />}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Spin>

      {/* 目标类型 + 渠道分布 */}
      {report && (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="目标类型分布" size="small">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={goalTypeData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="goal" type="category" width={110} tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="count" name="推荐数" radius={[0, 4, 4, 0]}>
                    {goalTypeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="渠道分布" size="small">
              {channelPieData.length > 0 ? (
                <Row>
                  <Col span={12}>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={channelPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="count"
                          nameKey="channel"
                          label={({ channel, percent }: any) =>
                            `${channel} ${((percent ?? 0) * 100).toFixed(0)}%`
                          }
                        >
                          {channelPieData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <RTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Col>
                  <Col span={12}>
                    <Space direction="vertical" size={8} style={{ paddingTop: 16 }}>
                      {channelPieData
                        .sort((a, b) => b.count - a.count)
                        .map((item, i) => {
                          const total = channelPieData.reduce((s, c) => s + c.count, 0);
                          return (
                            <div key={item.channel}>
                              <Space>
                                <Badge color={COLORS[i % COLORS.length]} />
                                <Text>{item.channel}</Text>
                                <Text type="secondary">
                                  {item.count} ({((item.count / total) * 100).toFixed(0)}%)
                                </Text>
                              </Space>
                            </div>
                          );
                        })}
                    </Space>
                  </Col>
                </Row>
              ) : (
                <Empty description="暂无渠道数据" />
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Divider />

      {/* 渠道效果 + 实验对比 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <ChannelAnalysisCard days={days} />
        </Col>
        <Col xs={24} lg={10}>
          <ExperimentCompareCard days={days} />
        </Col>
      </Row>
    </Space>
  );
};

export default StrategyEffectivenessPage;
