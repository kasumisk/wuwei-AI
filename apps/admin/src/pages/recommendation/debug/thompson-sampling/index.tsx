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
} from 'antd';
import {
  ExperimentOutlined,
  SearchOutlined,
  ReloadOutlined,
  UserOutlined,
  TrophyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import {
  useConvergence,
  useUserConvergence,
  type FoodBetaDistribution,
  type GlobalConvergenceStats,
  type UserConvergenceOverview,
} from '@/services/thompsonSamplingService';

const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'thompson-sampling',
  title: 'Thompson Sampling',
  icon: 'ExperimentOutlined',
  order: 10,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const PHASE_CONFIG = {
  exploring: { label: '探索期', color: '#faad14', description: '收敛度 < 0.3，系统仍在大量探索' },
  converging: { label: '收敛中', color: '#1890ff', description: '收敛度 0.3-0.7，偏好逐渐明确' },
  converged: { label: '已收敛', color: '#52c41a', description: '收敛度 ≥ 0.7，偏好已稳定' },
};

const PHASE_COLORS = ['#faad14', '#1890ff', '#52c41a'];

// ==================== 主组件 ====================

const ThompsonSamplingPage: React.FC = () => {
  const [days, setDays] = useState(30);
  const [topN, setTopN] = useState(10);
  const [userId, setUserId] = useState('');
  const [searchUserId, setSearchUserId] = useState('');

  const { data: globalStats, isLoading, refetch } = useConvergence({ days, topN });
  const {
    data: userStats,
    isLoading: userLoading,
    isError: userError,
  } = useUserConvergence(searchUserId, { days }, { enabled: !!searchUserId });

  const globalData = globalStats as GlobalConvergenceStats | undefined;
  const userData = userStats as UserConvergenceOverview | undefined;

  // 告警系统
  const alerts: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
  if (globalData) {
    const { phaseDistribution, avgConvergence, activeUserCount } = globalData;
    const total =
      phaseDistribution.exploring + phaseDistribution.converging + phaseDistribution.converged;
    if (total > 0) {
      const exploringPct = phaseDistribution.exploring / total;
      if (exploringPct > 0.6)
        alerts.push({
          type: 'warning',
          message: `探索期用户占比 ${(exploringPct * 100).toFixed(0)}%（>60%），系统推荐探索偏多，可能影响用户体验`,
        });
      if (avgConvergence < 0.2)
        alerts.push({
          type: 'warning',
          message: `全局平均收敛度 ${(avgConvergence * 100).toFixed(1)}%（<20%），偏好学习整体偏慢`,
        });
    }
    if (activeUserCount === 0) alerts.push({ type: 'info', message: '当前无活跃用户反馈数据' });
  }

  // 阶段分布饼图数据
  const phaseData = globalData
    ? [
        { name: '探索期', value: globalData.phaseDistribution.exploring },
        { name: '收敛中', value: globalData.phaseDistribution.converging },
        { name: '已收敛', value: globalData.phaseDistribution.converged },
      ]
    : [];

  // 收敛排行柱状图
  const convergenceBarData = (foods: FoodBetaDistribution[]) =>
    foods.map((f) => ({
      name: f.foodName.length > 8 ? f.foodName.slice(0, 8) + '…' : f.foodName,
      fullName: f.foodName,
      convergence: +(f.convergence * 100).toFixed(1),
      mean: +(f.mean * 100).toFixed(1),
      interactions: f.totalInteractions,
    }));

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
          <Col>
            <Text strong>排行数量：</Text>
            <Select
              value={topN}
              onChange={setTopN}
              style={{ width: 80 }}
              options={[
                { label: '5', value: 5 },
                { label: '10', value: 10 },
                { label: '20', value: 20 },
              ]}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              刷新
            </Button>
          </Col>
        </Row>
      </Card>

      <Spin spinning={isLoading}>
        {/* KPI 卡片行 */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="活跃用户数"
                value={globalData?.activeUserCount ?? '-'}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="平均收敛度"
                value={globalData ? (globalData.avgConvergence * 100).toFixed(1) : '-'}
                suffix="%"
                valueStyle={{
                  color: globalData
                    ? globalData.avgConvergence >= 0.7
                      ? '#52c41a'
                      : globalData.avgConvergence >= 0.3
                        ? '#1890ff'
                        : '#faad14'
                    : undefined,
                }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="探索期用户"
                value={globalData?.phaseDistribution.exploring ?? '-'}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="收敛中用户"
                value={globalData?.phaseDistribution.converging ?? '-'}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已收敛用户"
                value={globalData?.phaseDistribution.converged ?? '-'}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="统计窗口" value={days} suffix="天" />
            </Card>
          </Col>
        </Row>

        {/* 阶段分布饼图 + 收敛排行 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={8}>
            <Card title="用户阶段分布" size="small" style={{ height: '100%' }}>
              {phaseData.reduce((s, d) => s + d.value, 0) > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={phaseData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {phaseData.map((_entry, index) => (
                        <Cell key={index} fill={PHASE_COLORS[index]} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="暂无数据" />
              )}
              <div style={{ marginTop: 8 }}>
                {Object.entries(PHASE_CONFIG).map(([key, cfg]) => (
                  <div key={key} style={{ marginBottom: 4 }}>
                    <Tag color={cfg.color} style={{ minWidth: 60 }}>
                      {cfg.label}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {cfg.description}
                    </Text>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card
              title={
                <Space>
                  <TrophyOutlined style={{ color: '#52c41a' }} />
                  <span>最高收敛食物 Top {topN}</span>
                </Space>
              }
              size="small"
              style={{ height: '100%' }}
            >
              {globalData?.mostConverged.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={convergenceBarData(globalData.mostConverged)}
                    layout="vertical"
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                    <RechartsTooltip
                      formatter={
                        ((value: number, name: string) => [
                          `${value}%`,
                          name === 'convergence' ? '收敛度' : '接受率',
                        ]) as any
                      }
                    />
                    <Bar dataKey="convergence" fill="#52c41a" name="convergence" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="暂无数据" />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card
              title={
                <Space>
                  <WarningOutlined style={{ color: '#faad14' }} />
                  <span>最低收敛食物 Top {topN}</span>
                </Space>
              }
              size="small"
              style={{ height: '100%' }}
            >
              {globalData?.leastConverged.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={convergenceBarData(globalData.leastConverged)}
                    layout="vertical"
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                    <RechartsTooltip
                      formatter={
                        ((value: number, name: string) => [
                          `${value}%`,
                          name === 'convergence' ? '收敛度' : '方差',
                        ]) as any
                      }
                    />
                    <Bar dataKey="convergence" fill="#faad14" name="convergence" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="暂无数据" />
              )}
            </Card>
          </Col>
        </Row>

        {/* 最高收敛食物明细表 */}
        <Card title="食物收敛明细" size="small" style={{ marginBottom: 16 }}>
          <Table
            dataSource={[
              ...(globalData?.mostConverged ?? []),
              ...(globalData?.leastConverged ?? []),
            ]}
            rowKey={(r) => r.foodName}
            size="small"
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: '食物名称',
                dataIndex: 'foodName',
                key: 'foodName',
                width: 160,
                render: (name: string) => <Text strong>{name}</Text>,
              },
              {
                title: '收敛度',
                dataIndex: 'convergence',
                key: 'convergence',
                width: 160,
                sorter: (a: FoodBetaDistribution, b: FoodBetaDistribution) =>
                  a.convergence - b.convergence,
                defaultSortOrder: 'descend',
                render: (val: number) => (
                  <Space>
                    <Progress
                      percent={+(val * 100).toFixed(1)}
                      size="small"
                      style={{ width: 80 }}
                      strokeColor={val >= 0.7 ? '#52c41a' : val >= 0.3 ? '#1890ff' : '#faad14'}
                    />
                    <Tag color={val >= 0.7 ? 'success' : val >= 0.3 ? 'processing' : 'warning'}>
                      {val >= 0.7 ? '已收敛' : val >= 0.3 ? '收敛中' : '探索期'}
                    </Tag>
                  </Space>
                ),
              },
              {
                title: '接受率 (Mean)',
                dataIndex: 'mean',
                key: 'mean',
                width: 120,
                render: (val: number) => (
                  <Text style={{ color: val >= 0.5 ? '#52c41a' : '#faad14' }}>
                    {(val * 100).toFixed(1)}%
                  </Text>
                ),
              },
              {
                title: '方差',
                dataIndex: 'variance',
                key: 'variance',
                width: 100,
                render: (val: number) => (
                  <Tooltip title="方差越小表示估计越稳定">
                    <Text type="secondary">{val.toFixed(4)}</Text>
                  </Tooltip>
                ),
              },
              {
                title: 'Alpha / Beta',
                key: 'ab',
                width: 120,
                render: (_: unknown, record: FoodBetaDistribution) => (
                  <Text type="secondary">
                    α={record.alpha} / β={record.beta}
                  </Text>
                ),
              },
              {
                title: '接受/拒绝',
                key: 'acceptReject',
                width: 120,
                render: (_: unknown, record: FoodBetaDistribution) => (
                  <Space>
                    <Tag color="green">{record.accepted} 接受</Tag>
                    <Tag color="red">{record.rejected} 拒绝</Tag>
                  </Space>
                ),
              },
              {
                title: '总交互',
                dataIndex: 'totalInteractions',
                key: 'totalInteractions',
                width: 80,
                sorter: (a: FoodBetaDistribution, b: FoodBetaDistribution) =>
                  a.totalInteractions - b.totalInteractions,
              },
            ]}
          />
        </Card>
      </Spin>

      {/* 单用户查询 */}
      <Card
        title={
          <Space>
            <UserOutlined />
            <span>单用户收敛详情</span>
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
              <Alert type="error" message="查询失败，请检查用户 ID 是否存在" showIcon />
            ) : userData ? (
              <>
                {/* 用户概览 */}
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic title="食物数量" value={userData.foodCount} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic
                        title="平均收敛度"
                        value={(userData.avgConvergence * 100).toFixed(1)}
                        suffix="%"
                      />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic title="总交互次数" value={userData.totalInteractions} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
                      <Statistic
                        title="当前阶段"
                        value={
                          PHASE_CONFIG[userData.phase as keyof typeof PHASE_CONFIG]?.label ??
                          userData.phase
                        }
                        valueStyle={{
                          color:
                            PHASE_CONFIG[userData.phase as keyof typeof PHASE_CONFIG]?.color ??
                            '#666',
                        }}
                      />
                    </Card>
                  </Col>
                </Row>

                {/* 用户食物 Beta 分布散点图 */}
                {userData.distributions.length > 0 && (
                  <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col span={24}>
                      <Card title="食物偏好分布（接受率 vs 收敛度）" size="small">
                        <ResponsiveContainer width="100%" height={300}>
                          <ScatterChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="mean"
                              type="number"
                              domain={[0, 1]}
                              name="接受率"
                              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                            />
                            <YAxis
                              dataKey="convergence"
                              type="number"
                              domain={[0, 1]}
                              name="收敛度"
                              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                            />
                            <ZAxis dataKey="totalInteractions" range={[40, 400]} name="交互次数" />
                            <RechartsTooltip
                              content={({ payload }) => {
                                if (!payload?.length) return null;
                                const d = payload[0].payload as FoodBetaDistribution;
                                return (
                                  <div
                                    style={{
                                      background: '#fff',
                                      border: '1px solid #ddd',
                                      padding: 8,
                                      borderRadius: 4,
                                      fontSize: 12,
                                    }}
                                  >
                                    <div style={{ fontWeight: 600 }}>{d.foodName}</div>
                                    <div>接受率: {(d.mean * 100).toFixed(1)}%</div>
                                    <div>收敛度: {(d.convergence * 100).toFixed(1)}%</div>
                                    <div>
                                      交互: {d.totalInteractions}次 (α={d.alpha}, β={d.beta})
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Scatter
                              data={userData.distributions}
                              fill="#1890ff"
                              fillOpacity={0.7}
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </Card>
                    </Col>
                  </Row>
                )}

                {/* 用户食物收敛明细表 */}
                <Table
                  dataSource={userData.distributions}
                  rowKey={(r) => r.foodName}
                  size="small"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    {
                      title: '食物名称',
                      dataIndex: 'foodName',
                      key: 'foodName',
                      render: (name: string) => <Text strong>{name}</Text>,
                    },
                    {
                      title: '收敛度',
                      dataIndex: 'convergence',
                      key: 'convergence',
                      sorter: (a: FoodBetaDistribution, b: FoodBetaDistribution) =>
                        a.convergence - b.convergence,
                      defaultSortOrder: 'descend',
                      render: (val: number) => (
                        <Progress
                          percent={+(val * 100).toFixed(1)}
                          size="small"
                          style={{ width: 100 }}
                          strokeColor={val >= 0.7 ? '#52c41a' : val >= 0.3 ? '#1890ff' : '#faad14'}
                        />
                      ),
                    },
                    {
                      title: '接受率',
                      dataIndex: 'mean',
                      key: 'mean',
                      render: (val: number) => `${(val * 100).toFixed(1)}%`,
                    },
                    {
                      title: '接受/拒绝',
                      key: 'ar',
                      render: (_: unknown, r: FoodBetaDistribution) =>
                        `${r.accepted} / ${r.rejected}`,
                    },
                    {
                      title: '总交互',
                      dataIndex: 'totalInteractions',
                      key: 'totalInteractions',
                      sorter: (a: FoodBetaDistribution, b: FoodBetaDistribution) =>
                        a.totalInteractions - b.totalInteractions,
                    },
                  ]}
                />
              </>
            ) : null}
          </Spin>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
            <ExperimentOutlined style={{ fontSize: 36, marginBottom: 8 }} />
            <br />
            <Text type="secondary">输入用户 ID 查看其 Thompson Sampling 收敛详情</Text>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ThompsonSamplingPage;
