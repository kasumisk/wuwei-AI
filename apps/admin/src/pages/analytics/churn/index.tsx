import React, { useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Space,
  Spin,
  Empty,
  Progress,
  Input,
  Divider,
  Typography,
  Alert,
  Button,
  Tooltip,
  Badge,
} from 'antd';
import {
  AlertOutlined,
  UserOutlined,
  SearchOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  FireOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ArrowRightOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  ReferenceLine,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import {
  useChurnDistribution,
  useChurnPrediction,
  type ChurnRiskLevel,
  type ChurnPrediction,
} from '@/services/churnPredictionService';

const { Text } = Typography;
const { Search } = Input;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'analytics-churn',
  title: '流失预测',
  icon: 'AlertOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const RISK_COLORS: Record<ChurnRiskLevel, string> = {
  low: '#52c41a',
  medium: '#faad14',
  high: '#ff7a00',
  critical: '#ff4d4f',
};

const RISK_LABELS: Record<ChurnRiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极危',
};

const FEATURE_LABELS: Record<string, string> = {
  recency: '活跃时效',
  frequency: '记录频率',
  complianceDecay: '依从衰减',
  streakHealth: '连续健康',
  feedbackRatio: '反馈质量',
  mealSkipRate: '漏餐率',
  varietyDrop: '食物多样',
  engagementDrop: '参与衰减',
};

// 风险因素对应的干预建议
const INTERVENTION_TIPS: Record<string, string> = {
  recency: '发送个性化召回通知，提供限时福利',
  frequency: '设置每日打卡提醒，增加轻量级任务',
  complianceDecay: '简化推荐方案，降低执行门槛',
  streakHealth: '发送连续记录激励，设置里程碑奖励',
  feedbackRatio: '优化反馈流程，减少操作步骤',
  mealSkipRate: '发送餐前推送提醒，提供快捷记录入口',
  varietyDrop: '推荐新食物，增加探索类内容',
  engagementDrop: '发送社区内容推送，增加互动元素',
};

const PIE_COLORS = ['#52c41a', '#faad14', '#ff7a00', '#ff4d4f'];

function getRiskLevel(risk: number): ChurnRiskLevel {
  if (risk >= 0.8) return 'critical';
  if (risk >= 0.6) return 'high';
  if (risk >= 0.3) return 'medium';
  return 'low';
}

// ==================== 单用户预测面板 ====================

const UserPredictionPanel: React.FC = () => {
  const [inputId, setInputId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const navigate = useNavigate();

  const { data, isLoading, isError } = useChurnPrediction(targetUserId);

  const radarData = data?.features.map((f) => ({
    subject: FEATURE_LABELS[f.name] ?? f.name,
    value: Math.round(f.riskScore * 100),
    fullMark: 100,
  }));

  // 按加权得分排序的特征
  const sortedFeatures = useMemo(() => {
    if (!data?.features) return [];
    return [...data.features].sort((a, b) => b.weightedScore - a.weightedScore);
  }, [data]);

  // 基于风险因素生成干预建议
  const interventions = useMemo(() => {
    if (!data?.topRiskFactors) return [];
    return data.topRiskFactors.map((f) => ({
      factor: f,
      label: FEATURE_LABELS[f] ?? f,
      tip: INTERVENTION_TIPS[f] ?? '建议人工评估后制定干预方案',
    }));
  }, [data]);

  return (
    <Card
      title={
        <Space>
          <SearchOutlined />
          <span>单用户流失预测</span>
        </Space>
      }
      size="small"
    >
      <Search
        placeholder="输入 User ID 进行预测"
        value={inputId}
        onChange={(e) => setInputId(e.target.value)}
        onSearch={(val) => setTargetUserId(val.trim())}
        enterButton="预测"
        style={{ maxWidth: 420, marginBottom: 16 }}
        allowClear
      />

      {isLoading && <Spin />}
      {isError && <Alert type="error" message="获取预测失败，请检查 User ID 是否正确" />}
      {data && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 风险等级告警 */}
          {data.riskLevel === 'critical' && (
            <Alert
              type="error"
              message={`该用户流失风险极高 (${Math.round(data.churnRisk * 100)}%)，建议立即干预`}
              showIcon
              icon={<FireOutlined />}
              action={
                <Button
                  size="small"
                  onClick={() => navigate(`/user/detail/${data.userId}`)}
                  icon={<EyeOutlined />}
                >
                  查看用户
                </Button>
              }
            />
          )}
          {data.riskLevel === 'high' && (
            <Alert
              type="warning"
              message={`该用户处于高风险状态 (${Math.round(data.churnRisk * 100)}%)，建议尽快干预`}
              showIcon
            />
          )}

          <Row gutter={[16, 16]}>
            {/* 左侧：综合评分 */}
            <Col xs={24} md={6}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Card
                  size="small"
                  style={{ borderColor: RISK_COLORS[data.riskLevel], borderWidth: 2 }}
                >
                  <Statistic
                    title="综合流失风险"
                    value={Math.round(data.churnRisk * 100)}
                    suffix="%"
                    valueStyle={{ color: RISK_COLORS[data.riskLevel], fontSize: 36 }}
                  />
                  <Tag color={RISK_COLORS[data.riskLevel]} style={{ marginTop: 8 }}>
                    {RISK_LABELS[data.riskLevel]}
                  </Tag>
                </Card>
                <Card size="small">
                  <Statistic
                    title="置信度"
                    value={Math.round(data.confidence * 100)}
                    suffix="%"
                    prefix={<SafetyCertificateOutlined />}
                    valueStyle={{ color: data.confidence >= 0.7 ? '#52c41a' : '#faad14' }}
                  />
                </Card>
                <Card size="small" title="主要风险因素">
                  <Space direction="vertical" size={4}>
                    {data.topRiskFactors.map((f) => (
                      <Tag key={f} color="orange">
                        {FEATURE_LABELS[f] ?? f}
                      </Tag>
                    ))}
                  </Space>
                </Card>
                <Button
                  block
                  onClick={() => navigate(`/user/detail/${data.userId}`)}
                  icon={<EyeOutlined />}
                >
                  查看用户详情
                </Button>
              </Space>
            </Col>

            {/* 中间：雷达图 */}
            <Col xs={24} md={10}>
              <Card size="small" title="特征风险雷达图">
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      name="风险分"
                      dataKey="value"
                      stroke={RISK_COLORS[data.riskLevel]}
                      fill={RISK_COLORS[data.riskLevel]}
                      fillOpacity={0.25}
                    />
                    <RTooltip formatter={(val: number) => [`${val}%`, '风险分']} />
                  </RadarChart>
                </ResponsiveContainer>
              </Card>
            </Col>

            {/* 右侧：干预建议 */}
            <Col xs={24} md={8}>
              <Card
                size="small"
                title={
                  <Space>
                    <MedicineBoxOutlined style={{ color: '#1677ff' }} />
                    <span>干预建议</span>
                  </Space>
                }
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {interventions.map((item, i) => (
                    <Card
                      key={item.factor}
                      size="small"
                      style={{ background: i === 0 ? '#fff7e6' : undefined }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        <Tag color="orange">{item.label}</Tag>
                        {i === 0 && <Tag color="red">优先</Tag>}
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.tip}
                      </Text>
                    </Card>
                  ))}
                  {interventions.length === 0 && <Text type="secondary">暂无特定干预建议</Text>}
                </Space>
              </Card>
            </Col>
          </Row>

          {/* 特征明细 */}
          <Card size="small" title="特征明细">
            <Table
              size="small"
              dataSource={sortedFeatures}
              rowKey="name"
              pagination={false}
              columns={[
                {
                  title: '特征',
                  dataIndex: 'name',
                  render: (v: string) => (
                    <Space>
                      {FEATURE_LABELS[v] ?? v}
                      {data.topRiskFactors.includes(v) && (
                        <Tag color="error" style={{ fontSize: 10 }}>
                          风险因素
                        </Tag>
                      )}
                    </Space>
                  ),
                },
                {
                  title: '原始值',
                  dataIndex: 'rawValue',
                  render: (v: number) => v.toFixed(3),
                },
                {
                  title: '风险分',
                  dataIndex: 'riskScore',
                  render: (v: number) => (
                    <Progress
                      percent={Math.round(v * 100)}
                      size="small"
                      strokeColor={
                        v >= 0.8
                          ? '#ff4d4f'
                          : v >= 0.6
                            ? '#ff7a00'
                            : v >= 0.3
                              ? '#faad14'
                              : '#52c41a'
                      }
                      style={{ width: 120 }}
                    />
                  ),
                },
                {
                  title: '权重',
                  dataIndex: 'weight',
                  render: (v: number) => `${(v * 100).toFixed(0)}%`,
                },
                {
                  title: '加权得分',
                  dataIndex: 'weightedScore',
                  render: (v: number) => (
                    <Text strong style={{ color: v >= 0.1 ? '#ff4d4f' : undefined }}>
                      {v.toFixed(4)}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      )}
    </Card>
  );
};

// ==================== 主页面 ====================

const ChurnPredictionPage: React.FC = () => {
  const navigate = useNavigate();
  const [topN, setTopN] = useState(20);
  const { data, isLoading } = useChurnDistribution(topN);

  const pieData = data
    ? [
        { name: RISK_LABELS.low, value: data.distribution.low },
        { name: RISK_LABELS.medium, value: data.distribution.medium },
        { name: RISK_LABELS.high, value: data.distribution.high },
        { name: RISK_LABELS.critical, value: data.distribution.critical },
      ]
    : [];

  // 高危比例
  const criticalRatio = useMemo(() => {
    if (!data || data.totalUsers === 0) return 0;
    return (data.distribution.critical + data.distribution.high) / data.totalUsers;
  }, [data]);

  // 高风险用户的风险因素统计
  const riskFactorStats = useMemo(() => {
    if (!data?.highRiskUsers?.length) return [];
    const counts: Record<string, number> = {};
    data.highRiskUsers.forEach((u) => {
      u.topRiskFactors.forEach((f) => {
        counts[f] = (counts[f] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([factor, count]) => ({
        factor,
        label: FEATURE_LABELS[factor] ?? factor,
        count,
        percent: Math.round((count / data.highRiskUsers.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  // 告警
  const alerts = useMemo(() => {
    const items: { type: 'warning' | 'error'; message: string }[] = [];
    if (!data) return items;
    if (data.distribution.critical > 0) {
      items.push({
        type: 'error',
        message: `当前有 ${data.distribution.critical} 位极危用户（流失风险≥80%），建议立即介入`,
      });
    }
    if (criticalRatio > 0.2) {
      items.push({
        type: 'warning',
        message: `高危+极危用户占比 ${(criticalRatio * 100).toFixed(1)}%，超过 20% 警戒线`,
      });
    }
    if (data.avgRisk >= 0.4) {
      items.push({
        type: 'warning',
        message: `平均流失风险 ${Math.round(data.avgRisk * 100)}%，偏高，建议全面优化用户体验`,
      });
    }
    return items;
  }, [data, criticalRatio]);

  const highRiskColumns: ColumnsType<{
    userId: string;
    churnRisk: number;
    topRiskFactors: string[];
  }> = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_, __, i) => <Text type="secondary">{i + 1}</Text>,
    },
    {
      title: 'User ID',
      dataIndex: 'userId',
      ellipsis: true,
      render: (id: string) => (
        <Button type="link" size="small" onClick={() => navigate(`/user/detail/${id}`)}>
          {id.slice(0, 12)}...
        </Button>
      ),
    },
    {
      title: '流失风险',
      dataIndex: 'churnRisk',
      sorter: (a, b) => b.churnRisk - a.churnRisk,
      defaultSortOrder: 'ascend',
      width: 200,
      render: (v: number) => {
        const level = getRiskLevel(v);
        return (
          <Space>
            <Progress
              percent={Math.round(v * 100)}
              size="small"
              style={{ width: 100 }}
              strokeColor={RISK_COLORS[level]}
            />
            <Tag color={RISK_COLORS[level]}>{RISK_LABELS[level]}</Tag>
          </Space>
        );
      },
    },
    {
      title: '主要风险因素',
      dataIndex: 'topRiskFactors',
      render: (factors: string[]) => (
        <Space size={4} wrap>
          {factors.map((f) => (
            <Tooltip key={f} title={INTERVENTION_TIPS[f] ?? ''}>
              <Tag color="orange" style={{ fontSize: 11 }}>
                {FEATURE_LABELS[f] ?? f}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/user/detail/${record.userId}`)}
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <Spin spinning={isLoading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 健康告警 */}
        {alerts.map((alert, i) => (
          <Alert key={i} message={alert.message} type={alert.type} showIcon closable />
        ))}

        {/* 核心 KPI 卡片行 */}
        {data && (
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="监控用户"
                  value={data.totalUsers}
                  prefix={<TeamOutlined style={{ color: '#1677ff' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="极危用户"
                  value={data.distribution.critical}
                  prefix={<FireOutlined style={{ color: '#ff4d4f' }} />}
                  valueStyle={{ color: data.distribution.critical > 0 ? '#ff4d4f' : undefined }}
                  suffix={
                    data.totalUsers > 0 ? (
                      <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                        ({((data.distribution.critical / data.totalUsers) * 100).toFixed(0)}%)
                      </span>
                    ) : undefined
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="高风险用户"
                  value={data.distribution.high}
                  prefix={<WarningOutlined style={{ color: '#ff7a00' }} />}
                  valueStyle={{ color: data.distribution.high > 0 ? '#ff7a00' : undefined }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="中风险用户"
                  value={data.distribution.medium}
                  prefix={<AlertOutlined style={{ color: '#faad14' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="低风险用户"
                  value={data.distribution.low}
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <Card size="small" variant="borderless">
                <Statistic
                  title="平均风险"
                  value={Math.round(data.avgRisk * 100)}
                  suffix="%"
                  prefix={
                    <UserOutlined style={{ color: data.avgRisk >= 0.3 ? '#faad14' : '#52c41a' }} />
                  }
                  valueStyle={{ color: data.avgRisk >= 0.3 ? '#faad14' : '#52c41a' }}
                />
              </Card>
            </Col>
          </Row>
        )}

        {/* 分布图 + 风险因素统计 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card title="风险等级分布" size="small">
              {data ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i]} />
                        ))}
                      </Pie>
                      <RTooltip />
                      <Legend iconSize={10} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* 分布明细 */}
                  <div>
                    {pieData.map((item, i) => {
                      const pct =
                        data.totalUsers > 0
                          ? ((item.value / data.totalUsers) * 100).toFixed(1)
                          : '0';
                      return (
                        <div
                          key={item.name}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '4px 0',
                            borderBottom: '1px solid #f0f0f0',
                          }}
                        >
                          <Space>
                            <Badge color={PIE_COLORS[i]} />
                            <Text>{item.name}</Text>
                          </Space>
                          <Space>
                            <Text strong>{item.value}</Text>
                            <Text type="secondary">({pct}%)</Text>
                          </Space>
                        </div>
                      );
                    })}
                  </div>
                </Space>
              ) : (
                <Empty />
              )}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card title="风险等级条形" size="small">
              {data ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={pieData}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="value" name="用户数" radius={[4, 4, 0, 0]}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty />
              )}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card
              title={
                <Space>
                  <AlertOutlined style={{ color: '#ff7a00' }} />
                  <span>高频风险因素</span>
                </Space>
              }
              size="small"
            >
              {riskFactorStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={riskFactorStats} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="label" type="category" width={80} tick={{ fontSize: 11 }} />
                    <RTooltip
                      formatter={(
                        value: number,
                        _: string,
                        props: { payload: { percent: number } }
                      ) => [`${value} 人 (${props.payload.percent}%)`, '出现次数']}
                    />
                    <Bar dataKey="count" name="出现次数" fill="#ff7a00" radius={[0, 4, 4, 0]}>
                      {riskFactorStats.map((_, i) => (
                        <Cell
                          key={i}
                          fill={i === 0 ? '#ff4d4f' : i === 1 ? '#ff7a00' : '#faad14'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="暂无数据" />
              )}
            </Card>
          </Col>
        </Row>

        {/* 高风险用户列表 */}
        <Card
          title={
            <Space>
              <AlertOutlined style={{ color: '#ff4d4f' }} />
              <span>高风险用户列表（Top {topN}）</span>
              {data && (
                <Tag color="error">
                  {data.distribution.high + data.distribution.critical} 人需关注
                </Tag>
              )}
            </Space>
          }
          size="small"
          extra={
            <Space>
              {[10, 20, 50].map((n) => (
                <Tag
                  key={n}
                  color={topN === n ? 'blue' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setTopN(n)}
                >
                  Top {n}
                </Tag>
              ))}
            </Space>
          }
        >
          <Table
            size="small"
            dataSource={data?.highRiskUsers ?? []}
            rowKey="userId"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            columns={highRiskColumns}
          />
        </Card>

        <Divider />

        {/* 单用户预测 */}
        <UserPredictionPanel />
      </Space>
    </Spin>
  );
};

export default ChurnPredictionPage;
