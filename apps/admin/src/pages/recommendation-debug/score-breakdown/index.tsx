import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Row,
  Col,
  Tag,
  Space,
  Typography,
  Descriptions,
  Statistic,
  Alert,
  Spin,
  Empty,
  Table,
  Divider,
  Progress,
  Tooltip,
} from 'antd';
import {
  SearchOutlined,
  AimOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  ExperimentOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
  Legend,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useScoreBreakdown,
  type ScoreBreakdownResult,
  type ScoreDimensionDetail,
  type ScoreChainAdjustment,
} from '@/services/recommendDebugService';

const { Text, Title } = Typography;

export const routeConfig = {
  name: 'recommend-score-breakdown',
  title: '评分拆解',
  icon: 'AimOutlined',
  order: 7,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const mealTypeOptions = [
  { label: '使用默认', value: '' },
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
];

const goalTypeOptions = [
  { label: '使用用户默认', value: '' },
  { label: '减脂', value: 'fat_loss' },
  { label: '增肌', value: 'muscle_gain' },
  { label: '健康', value: 'health' },
  { label: '习惯养成', value: 'habit' },
];

const dimensionLabels: Record<string, string> = {
  calories: '热量匹配',
  protein: '蛋白质',
  carbs: '碳水',
  fat: '脂肪',
  quality: '品质',
  satiety: '饱腹感',
  glycemic: '血糖指数',
  nutrientDensity: '营养密度',
  inflammation: '抗炎',
  fiber: '膳食纤维',
  seasonality: '季节性',
  executability: '可执行性',
  popularity: '热门度',
  acquisition: '获取性',
};

const dimensionDescriptions: Record<string, string> = {
  calories: '该食物的热量与用户目标餐次热量的匹配程度',
  protein: '蛋白质含量与目标的匹配程度',
  carbs: '碳水化合物含量与目标的匹配程度',
  fat: '脂肪含量与目标的匹配程度',
  quality: '食物整体品质评估（NOVA分级、加工程度等）',
  satiety: '食物的饱腹感指数',
  glycemic: '血糖指数表现（低GI更优）',
  nutrientDensity: '每单位热量的营养素密度',
  inflammation: '食物的抗炎属性评估',
  fiber: '膳食纤维含量评估',
  seasonality: '当前季节下该食物的适宜度',
  executability: '用户在当前场景下获取和烹饪该食物的可执行性',
  popularity: '食物在用户所在地区的流行程度',
  acquisition: '食物的可获取性和购买便利性',
};

// ==================== 工具函数 ====================

const scoreColor = (score: number): string => {
  if (score >= 0.8) return '#52c41a';
  if (score >= 0.6) return '#1677ff';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
};

const scorePercent = (score: number): number => Math.round(score * 100);

// ==================== 14维评分雷达图 ====================

const DimensionRadarChart: React.FC<{ dimensions: Record<string, ScoreDimensionDetail> }> = ({
  dimensions,
}) => {
  const radarData = Object.entries(dimensions)
    .filter(([, val]) => val != null)
    .map(([key, val]) => ({
      dimension: dimensionLabels[key] || key,
      raw: Math.round(val.raw * 100),
      weighted: Math.round(val.weighted * 100),
      weight: val.weight,
      key,
    }));

  if (radarData.length === 0) return <Empty description="无评分维度数据" />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={350}>
        <RadarChart data={radarData}>
          <PolarGrid />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
          <Radar
            name="原始分 (raw)"
            dataKey="raw"
            stroke="#8884d8"
            fill="#8884d8"
            fillOpacity={0.15}
          />
          <Radar
            name="加权分 (weighted)"
            dataKey="weighted"
            stroke="#1677ff"
            fill="#1677ff"
            fillOpacity={0.25}
          />
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ==================== 维度得分详细表格 ====================

const DimensionDetailTable: React.FC<{
  dimensions: Record<string, ScoreDimensionDetail>;
}> = ({ dimensions }) => {
  const dataSource = Object.entries(dimensions)
    .filter(([, val]) => val != null)
    .map(([key, val]) => ({
      key,
      dimension: dimensionLabels[key] || key,
      description: dimensionDescriptions[key] || '-',
      raw: val.raw,
      weight: val.weight,
      weighted: val.weighted,
    }))
    .sort((a, b) => b.weighted - a.weighted);

  const columns: ColumnsType<(typeof dataSource)[0]> = [
    {
      title: '维度',
      dataIndex: 'dimension',
      key: 'dimension',
      width: 120,
      render: (text: string, record) => (
        <Tooltip title={record.description}>
          <Space>
            <Text strong>{text}</Text>
            <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
          </Space>
        </Tooltip>
      ),
    },
    {
      title: '原始分',
      dataIndex: 'raw',
      key: 'raw',
      width: 120,
      sorter: (a, b) => a.raw - b.raw,
      render: (raw: number) => (
        <Space>
          <Progress
            percent={scorePercent(raw)}
            size="small"
            strokeColor={scoreColor(raw)}
            style={{ width: 80 }}
            format={() => ''}
          />
          <Text style={{ color: scoreColor(raw), fontSize: 12 }}>
            {(raw * 100).toFixed(1)}
          </Text>
        </Space>
      ),
    },
    {
      title: '权重',
      dataIndex: 'weight',
      key: 'weight',
      width: 80,
      sorter: (a, b) => a.weight - b.weight,
      render: (weight: number) => (
        <Tag color={weight >= 0.1 ? 'blue' : 'default'}>
          {(weight * 100).toFixed(1)}%
        </Tag>
      ),
    },
    {
      title: '加权分',
      dataIndex: 'weighted',
      key: 'weighted',
      width: 120,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.weighted - b.weighted,
      render: (weighted: number) => (
        <Text strong style={{ color: scoreColor(weighted), fontSize: 14 }}>
          {(weighted * 100).toFixed(2)}
        </Text>
      ),
    },
    {
      title: '贡献占比',
      key: 'contribution',
      width: 100,
      render: (_, record) => {
        const totalWeighted = dataSource.reduce((s, d) => s + d.weighted, 0);
        const pct = totalWeighted > 0 ? (record.weighted / totalWeighted) * 100 : 0;
        return (
          <Progress
            percent={Math.round(pct)}
            size="small"
            strokeColor={pct >= 15 ? '#1677ff' : '#d9d9d9'}
            format={(p) => `${p}%`}
          />
        );
      },
    },
  ];

  return (
    <Table
      dataSource={dataSource}
      columns={columns}
      size="small"
      pagination={false}
      summary={(data) => {
        const totalRaw =
          data.reduce((s, d) => s + d.raw, 0) / (data.length || 1);
        const totalWeighted = data.reduce((s, d) => s + d.weighted, 0);
        return (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <Text strong>汇总</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1}>
              <Text type="secondary">均值: {(totalRaw * 100).toFixed(1)}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2}>
              <Text type="secondary">-</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              <Text strong style={{ color: '#1677ff' }}>
                合计: {(totalWeighted * 100).toFixed(2)}
              </Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4}>
              <Text type="secondary">100%</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        );
      }}
    />
  );
};

// ==================== 评分因子链可视化 ====================

const ScoreChainVisualization: React.FC<{
  chainResult: ScoreBreakdownResult['chainResult'];
}> = ({ chainResult }) => {
  if (!chainResult) return <Empty description="无因子链数据" />;

  const { baseScore, finalScore, adjustments } = chainResult;

  // Build bar chart data for adjustments
  const barData = adjustments.map((adj, i) => ({
    name: adj.factorName,
    multiplier: adj.multiplier !== 1 ? parseFloat(((adj.multiplier - 1) * 100).toFixed(2)) : 0,
    additive: adj.additive !== 0 ? parseFloat((adj.additive * 100).toFixed(2)) : 0,
    reason: adj.reason,
    rawMultiplier: adj.multiplier,
    rawAdditive: adj.additive,
  }));

  const activeAdjustments = adjustments.filter(
    (a) => a.multiplier !== 1 || a.additive !== 0
  );

  return (
    <div>
      {/* 基础分 → 最终分 头部 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="基础分"
              value={(baseScore * 100).toFixed(1)}
              valueStyle={{ color: scoreColor(baseScore) }}
            />
          </Card>
        </Col>
        <Col
          span={8}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Space>
            <ArrowRightOutlined style={{ fontSize: 20, color: '#999' }} />
            <Tag color="processing">
              {activeAdjustments.length} 个因子调整
            </Tag>
            <ArrowRightOutlined style={{ fontSize: 20, color: '#999' }} />
          </Space>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="链路最终分"
              value={(finalScore * 100).toFixed(1)}
              valueStyle={{ color: scoreColor(finalScore), fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 因子调整柱状图 */}
      {barData.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 30)}>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ left: 100, right: 20, top: 5, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div
                      style={{
                        background: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: 6,
                        padding: '8px 12px',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{d.name}</div>
                      <div>乘数: ×{d.rawMultiplier.toFixed(3)}</div>
                      <div>加数: {d.rawAdditive >= 0 ? '+' : ''}{d.rawAdditive.toFixed(4)}</div>
                      <div style={{ color: '#666', marginTop: 4 }}>{d.reason}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="multiplier" name="乘数偏移(%)" fill="#1677ff" radius={[0, 4, 4, 0]}>
                {barData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.multiplier >= 0 ? '#52c41a' : '#ff4d4f'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 因子链详细表格 */}
      <Table
        dataSource={adjustments.map((a, i) => ({ ...a, key: i }))}
        size="small"
        pagination={false}
        columns={[
          {
            title: '因子名称',
            dataIndex: 'factorName',
            key: 'factorName',
            width: 140,
            render: (name: string) => <Text strong>{name}</Text>,
          },
          {
            title: '乘数',
            dataIndex: 'multiplier',
            key: 'multiplier',
            width: 100,
            render: (m: number) => {
              if (m === 1) return <Text type="secondary">×1.000 (无效果)</Text>;
              const color = m > 1 ? '#52c41a' : '#ff4d4f';
              return (
                <Text style={{ color }}>
                  ×{m.toFixed(3)} ({m > 1 ? '+' : ''}{((m - 1) * 100).toFixed(1)}%)
                </Text>
              );
            },
          },
          {
            title: '加数',
            dataIndex: 'additive',
            key: 'additive',
            width: 100,
            render: (a: number) => {
              if (a === 0) return <Text type="secondary">+0 (无效果)</Text>;
              const color = a > 0 ? '#52c41a' : '#ff4d4f';
              return (
                <Text style={{ color }}>
                  {a >= 0 ? '+' : ''}{a.toFixed(4)}
                </Text>
              );
            },
          },
          {
            title: '是否生效',
            key: 'active',
            width: 80,
            render: (_, record: ScoreChainAdjustment) => {
              const active = record.multiplier !== 1 || record.additive !== 0;
              return active ? (
                <Tag color="processing" icon={<CheckCircleOutlined />}>
                  生效
                </Tag>
              ) : (
                <Tag color="default">无效果</Tag>
              );
            },
          },
          {
            title: '原因',
            dataIndex: 'reason',
            key: 'reason',
            render: (reason: string) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {reason || '-'}
              </Text>
            ),
          },
        ]}
      />
    </div>
  );
};

// ==================== 健康修正器 ====================

const HealthModifierCard: React.FC<{
  healthModifier: ScoreBreakdownResult['healthModifier'];
}> = ({ healthModifier }) => {
  if (!healthModifier) return <Empty description="无健康修正数据" />;

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="最终乘数"
              value={healthModifier.finalMultiplier.toFixed(3)}
              valueStyle={{
                color:
                  healthModifier.finalMultiplier >= 1
                    ? '#52c41a'
                    : healthModifier.finalMultiplier >= 0.5
                    ? '#faad14'
                    : '#ff4d4f',
              }}
              prefix={<SafetyCertificateOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="否决状态"
              value={healthModifier.isVetoed ? '已否决' : '正常'}
              valueStyle={{
                color: healthModifier.isVetoed ? '#ff4d4f' : '#52c41a',
              }}
              prefix={
                healthModifier.isVetoed ? <CloseCircleOutlined /> : <CheckCircleOutlined />
              }
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="修正器数量"
              value={healthModifier.modifiers.length}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {healthModifier.isVetoed && (
        <Alert
          type="error"
          showIcon
          message="该食物已被健康修正器否决"
          description="由于用户的健康状况（过敏、疾病禁忌等），该食物不会出现在推荐结果中"
          style={{ marginBottom: 16 }}
        />
      )}

      {healthModifier.modifiers.length > 0 && (
        <Table
          dataSource={healthModifier.modifiers.map((m, i) => ({ ...m, key: i }))}
          size="small"
          pagination={false}
          columns={[
            {
              title: '修正器',
              key: 'name',
              width: 140,
              render: (_, record: any) => (
                <Text strong>{record.name || record.type || `修正器 #${record.key + 1}`}</Text>
              ),
            },
            {
              title: '乘数',
              key: 'multiplier',
              width: 80,
              render: (_, record: any) => {
                const m = record.multiplier ?? record.factor;
                if (m == null) return '-';
                return (
                  <Text style={{ color: m >= 1 ? '#52c41a' : '#ff4d4f' }}>
                    ×{m.toFixed(3)}
                  </Text>
                );
              },
            },
            {
              title: '否决',
              key: 'veto',
              width: 70,
              render: (_, record: any) => {
                const v = record.vetoed ?? record.isVetoed;
                return v ? (
                  <Tag color="error">是</Tag>
                ) : (
                  <Tag color="success">否</Tag>
                );
              },
            },
            {
              title: '原因/详情',
              key: 'reason',
              render: (_, record: any) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {record.reason || record.description || JSON.stringify(record)}
                </Text>
              ),
            },
          ]}
        />
      )}
    </div>
  );
};

// ==================== 完整结果展示 ====================

const BreakdownResultDisplay: React.FC<{ result: ScoreBreakdownResult }> = ({ result }) => {
  return (
    <div>
      {/* 顶部概要 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="食物"
              value={result.foodName}
              valueStyle={{ fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="基础分"
              value={(result.baseScore * 100).toFixed(1)}
              valueStyle={{ color: scoreColor(result.baseScore) }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="最终得分"
              value={(result.finalScore * 100).toFixed(1)}
              valueStyle={{ color: scoreColor(result.finalScore), fontWeight: 700, fontSize: 24 }}
              prefix={<AimOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Space direction="vertical" size={0}>
              <Text type="secondary" style={{ fontSize: 12 }}>目标 / 餐次 / 策略</Text>
              <Space size={4} wrap>
                <Tag color="green">{result.goalType}</Tag>
                <Tag color="blue">{result.mealType}</Tag>
              </Space>
              {result.strategy?.strategyName && (
                <Tag color="purple" style={{ marginTop: 4 }}>
                  {result.strategy.strategyName}
                </Tag>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 14 维雷达图 + 维度详细表格 */}
      <Card
        size="small"
        title={
          <Space>
            <ExperimentOutlined />
            <span>14维评分详情</span>
            <Tag>{Object.keys(result.dimensions).length} 个维度</Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col xs={24} lg={10}>
            <DimensionRadarChart dimensions={result.dimensions} />
          </Col>
          <Col xs={24} lg={14}>
            <DimensionDetailTable dimensions={result.dimensions} />
          </Col>
        </Row>
      </Card>

      {/* 评分因子链 */}
      <Card
        size="small"
        title={
          <Space>
            <ThunderboltOutlined />
            <span>评分因子链</span>
            <Tag color="processing">
              {result.chainResult?.adjustments?.length || 0} 个因子
            </Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <ScoreChainVisualization chainResult={result.chainResult} />
      </Card>

      {/* 健康修正 */}
      <Card
        size="small"
        title={
          <Space>
            <SafetyCertificateOutlined />
            <span>健康修正</span>
            {result.healthModifier?.isVetoed && <Tag color="error">已否决</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <HealthModifierCard healthModifier={result.healthModifier} />
      </Card>

      {/* 份量信息 */}
      {result.servingInfo && Object.keys(result.servingInfo).length > 0 && (
        <Card size="small" title="份量信息" style={{ marginBottom: 16 }}>
          <Descriptions column={3} size="small" bordered>
            {Object.entries(result.servingInfo).map(([key, val]) => (
              <Descriptions.Item key={key} label={key}>
                {typeof val === 'number' ? val.toFixed(2) : String(val ?? '-')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}

      {/* 得分流转总结 */}
      <Card size="small" title="得分流转总结">
        <Divider style={{ margin: '8px 0' }}>评分流转路径</Divider>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '12px 0',
          }}
        >
          <Card size="small" style={{ minWidth: 100, textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>14维基础分</Text>
            <div>
              <Text strong style={{ fontSize: 18, color: scoreColor(result.baseScore) }}>
                {(result.baseScore * 100).toFixed(1)}
              </Text>
            </div>
          </Card>

          <ArrowRightOutlined style={{ fontSize: 18, color: '#ccc' }} />

          <Card size="small" style={{ minWidth: 100, textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>因子链</Text>
            <div>
              <Text strong style={{ fontSize: 18, color: scoreColor(result.chainResult?.finalScore ?? 0) }}>
                {((result.chainResult?.finalScore ?? 0) * 100).toFixed(1)}
              </Text>
            </div>
          </Card>

          <ArrowRightOutlined style={{ fontSize: 18, color: '#ccc' }} />

          <Card size="small" style={{ minWidth: 100, textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>健康修正</Text>
            <div>
              <Text
                strong
                style={{
                  fontSize: 14,
                  color: result.healthModifier?.isVetoed ? '#ff4d4f' : '#52c41a',
                }}
              >
                ×{result.healthModifier?.finalMultiplier?.toFixed(3) ?? '1.000'}
              </Text>
            </div>
          </Card>

          <ArrowRightOutlined style={{ fontSize: 18, color: '#ccc' }} />

          <Card
            size="small"
            style={{
              minWidth: 120,
              textAlign: 'center',
              border: '2px solid',
              borderColor: scoreColor(result.finalScore),
            }}
          >
            <Text type="secondary" style={{ fontSize: 11 }}>最终得分</Text>
            <div>
              <Text
                strong
                style={{ fontSize: 22, color: scoreColor(result.finalScore) }}
              >
                {(result.finalScore * 100).toFixed(1)}
              </Text>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
};

// ==================== 主组件 ====================

const ScoreBreakdownPage: React.FC = () => {
  const [form] = Form.useForm();
  const [resultData, setResultData] = useState<ScoreBreakdownResult | null>(null);

  const mutation = useScoreBreakdown({
    onSuccess: (data) => setResultData(data),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setResultData(null);
      mutation.mutate({
        userId: values.userId,
        foodId: values.foodId,
        mealType: values.mealType || undefined,
        goalType: values.goalType || undefined,
      });
    } catch {
      // validation error
    }
  };

  return (
    <div>
      {/* 输入表单 */}
      <Card
        title={
          <Space>
            <AimOutlined />
            <span>评分拆解</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="输入用户 ID 和食物 ID，查看该食物在该用户场景下的完整评分拆解（14维基础评分 + 10因子链 + 健康修正 → 最终分）"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item
                name="userId"
                label="用户 ID"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <Input placeholder="输入用户 UUID" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item
                name="foodId"
                label="食物 ID"
                rules={[{ required: true, message: '请输入食物 ID' }]}
              >
                <Input placeholder="输入食物 UUID" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="mealType" label="餐次类型">
                <Select placeholder="默认" allowClear options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="goalType" label="目标类型">
                <Select placeholder="用户默认" allowClear options={goalTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleSubmit}
                  loading={mutation.isPending}
                  block
                  size="large"
                >
                  查看评分拆解
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* Loading */}
      {mutation.isPending && (
        <Card>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" tip="正在计算评分拆解..." />
          </div>
        </Card>
      )}

      {/* Error */}
      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          message="评分拆解失败"
          description={mutation.error?.message || '请检查用户 ID 和食物 ID 是否有效'}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Result */}
      {resultData && <BreakdownResultDisplay result={resultData} />}

      {/* Empty state */}
      {!mutation.isPending && !resultData && !mutation.isError && (
        <Card>
          <Empty description="输入用户 ID 和食物 ID，点击「查看评分拆解」查看完整评分分解" />
        </Card>
      )}
    </div>
  );
};

export default ScoreBreakdownPage;
