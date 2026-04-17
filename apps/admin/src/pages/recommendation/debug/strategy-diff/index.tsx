import React, { useState, useMemo } from 'react';
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
  Table,
  Statistic,
  Alert,
  Spin,
  Empty,
  Descriptions,
  Divider,
  Badge,
} from 'antd';
import {
  SwapOutlined,
  SearchOutlined,
  DiffOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useStrategyDiff,
  type StrategyDiffResult,
  type StrategyDiffFoodItem,
} from '@/services/recommendDebugService';

const { Text } = Typography;

export const routeConfig = {
  name: 'recommend-strategy-diff',
  title: '策略对比',
  icon: 'SwapOutlined',
  order: 8,
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

// ==================== 工具函数 ====================

const scoreColor = (score: number): string => {
  if (score >= 0.8) return '#52c41a';
  if (score >= 0.6) return '#1677ff';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
};

// ==================== 食物对比表格 ====================

const FoodComparisonTable: React.FC<{
  title: string;
  foods: StrategyDiffFoodItem[];
  color: string;
  icon: React.ReactNode;
}> = ({ title, foods, color, icon }) => {
  if (!foods || foods.length === 0) {
    return (
      <Card
        size="small"
        title={
          <Space>
            {icon}
            <span>{title} (0)</span>
          </Space>
        }
      >
        <Empty description="无食物" />
      </Card>
    );
  }

  const columns: ColumnsType<StrategyDiffFoodItem> = [
    {
      title: '#',
      key: 'idx',
      width: 40,
      render: (_, __, i) => <Badge count={i + 1} style={{ backgroundColor: color }} />,
    },
    {
      title: '食物名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '评分',
      dataIndex: 'score',
      key: 'score',
      width: 100,
      sorter: (a, b) => a.score - b.score,
      defaultSortOrder: 'descend',
      render: (score: number) => (
        <Text strong style={{ color: scoreColor(score) }}>
          {(score * 100).toFixed(1)}
        </Text>
      ),
    },
    {
      title: '热量',
      dataIndex: 'calories',
      key: 'calories',
      width: 100,
      sorter: (a, b) => a.calories - b.calories,
      render: (cal: number) => <Tag color="red">{Math.round(cal)} kcal</Tag>,
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          {icon}
          <span>
            {title} ({foods.length})
          </span>
        </Space>
      }
    >
      <Table dataSource={foods} columns={columns} rowKey="name" size="small" pagination={false} />
    </Card>
  );
};

// ==================== 评分分布散点图 ====================

const ScoreDistributionChart: React.FC<{
  resultA: StrategyDiffFoodItem[];
  resultB: StrategyDiffFoodItem[];
  nameA: string;
  nameB: string;
}> = ({ resultA, resultB, nameA, nameB }) => {
  if ((!resultA || resultA.length === 0) && (!resultB || resultB.length === 0)) {
    return null;
  }

  // Bar chart: top 15 foods from each, showing score comparison
  const allFoodNames = new Set<string>();
  resultA?.forEach((f) => allFoodNames.add(f.name));
  resultB?.forEach((f) => allFoodNames.add(f.name));

  const mapA = new Map(resultA?.map((f) => [f.name, f]) || []);
  const mapB = new Map(resultB?.map((f) => [f.name, f]) || []);

  // Get top foods by max score in either strategy
  const barData = Array.from(allFoodNames)
    .map((name) => ({
      name,
      scoreA: (mapA.get(name)?.score ?? 0) * 100,
      scoreB: (mapB.get(name)?.score ?? 0) * 100,
      caloriesA: mapA.get(name)?.calories ?? 0,
      caloriesB: mapB.get(name)?.calories ?? 0,
    }))
    .sort((a, b) => Math.max(b.scoreA, b.scoreB) - Math.max(a.scoreA, a.scoreB))
    .slice(0, 20);

  return (
    <Card size="small" title="Top 食物评分对比" style={{ marginBottom: 16 }}>
      <ResponsiveContainer width="100%" height={Math.max(300, barData.length * 28)}>
        <BarChart
          data={barData}
          layout="vertical"
          margin={{ left: 80, right: 20, top: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, 100]} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
          <RechartsTooltip
            formatter={(value: number, name: string) => [`${value.toFixed(1)}`, name]}
          />
          <Legend />
          <Bar dataKey="scoreA" name={nameA} fill="#1677ff" radius={[0, 2, 2, 0]} barSize={10} />
          <Bar dataKey="scoreB" name={nameB} fill="#fa541c" radius={[0, 2, 2, 0]} barSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
};

// ==================== 完整结果展示 ====================

const DiffResultDisplay: React.FC<{ result: StrategyDiffResult }> = ({ result }) => {
  const { strategyA, strategyB, comparison } = result;

  const avgScoreA = useMemo(() => {
    if (!result.resultA || result.resultA.length === 0) return 0;
    return result.resultA.reduce((s, f) => s + f.score, 0) / result.resultA.length;
  }, [result.resultA]);

  const avgScoreB = useMemo(() => {
    if (!result.resultB || result.resultB.length === 0) return 0;
    return result.resultB.reduce((s, f) => s + f.score, 0) / result.resultB.length;
  }, [result.resultB]);

  const avgCalA = useMemo(() => {
    if (!result.resultA || result.resultA.length === 0) return 0;
    return result.resultA.reduce((s, f) => s + f.calories, 0) / result.resultA.length;
  }, [result.resultA]);

  const avgCalB = useMemo(() => {
    if (!result.resultB || result.resultB.length === 0) return 0;
    return result.resultB.reduce((s, f) => s + f.calories, 0) / result.resultB.length;
  }, [result.resultB]);

  return (
    <div>
      {/* 对比概要 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12}>
          <Card
            size="small"
            style={{ borderTop: '3px solid #1677ff' }}
            title={
              <Space>
                <Badge color="#1677ff" />
                <Text strong>策略 A: {strategyA.name}</Text>
              </Space>
            }
          >
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="推荐食物"
                  value={comparison.totalFoodsA}
                  suffix="种"
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="平均评分"
                  value={(avgScoreA * 100).toFixed(1)}
                  valueStyle={{ color: scoreColor(avgScoreA) }}
                />
              </Col>
              <Col span={8}>
                <Statistic title="平均热量" value={Math.round(avgCalA)} suffix="kcal" />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card
            size="small"
            style={{ borderTop: '3px solid #fa541c' }}
            title={
              <Space>
                <Badge color="#fa541c" />
                <Text strong>策略 B: {strategyB.name}</Text>
              </Space>
            }
          >
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="推荐食物"
                  value={comparison.totalFoodsB}
                  suffix="种"
                  valueStyle={{ color: '#fa541c' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="平均评分"
                  value={(avgScoreB * 100).toFixed(1)}
                  valueStyle={{ color: scoreColor(avgScoreB) }}
                />
              </Col>
              <Col span={8}>
                <Statistic title="平均热量" value={Math.round(avgCalB)} suffix="kcal" />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 重叠分析 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} style={{ textAlign: 'center' }}>
          <Col span={6}>
            <Statistic
              title="仅策略 A"
              value={comparison.onlyInA.length}
              suffix="种"
              valueStyle={{ color: '#1677ff' }}
              prefix={<MinusCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="共有食物"
              value={comparison.commonCount}
              suffix="种"
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="仅策略 B"
              value={comparison.onlyInB.length}
              suffix="种"
              valueStyle={{ color: '#fa541c' }}
              prefix={<PlusCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="重叠率"
              value={
                comparison.totalFoodsA + comparison.totalFoodsB > 0
                  ? (
                      ((comparison.commonCount * 2) /
                        (comparison.totalFoodsA + comparison.totalFoodsB)) *
                      100
                    ).toFixed(1)
                  : 0
              }
              suffix="%"
              valueStyle={{ color: '#722ed1' }}
            />
          </Col>
        </Row>
      </Card>

      {result.note && (
        <Alert message={result.note} type="info" showIcon style={{ marginBottom: 16 }} />
      )}

      {/* 评分对比图 */}
      <ScoreDistributionChart
        resultA={result.resultA}
        resultB={result.resultB}
        nameA={strategyA.name}
        nameB={strategyB.name}
      />

      {/* 食物列表详情 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <FoodComparisonTable
            title={`仅策略 A 独有`}
            foods={comparison.onlyInA}
            color="#1677ff"
            icon={<MinusCircleOutlined style={{ color: '#1677ff' }} />}
          />
        </Col>
        <Col xs={24} md={12}>
          <FoodComparisonTable
            title={`仅策略 B 独有`}
            foods={comparison.onlyInB}
            color="#fa541c"
            icon={<PlusCircleOutlined style={{ color: '#fa541c' }} />}
          />
        </Col>
      </Row>

      <FoodComparisonTable
        title="共有食物"
        foods={comparison.common}
        color="#52c41a"
        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
      />

      {/* 策略配置差异 */}
      <Divider>策略配置差异</Divider>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                <Badge color="#1677ff" />
                <span>策略 A 配置</span>
              </Space>
            }
          >
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(strategyA.config, null, 2)}
            </pre>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                <Badge color="#fa541c" />
                <span>策略 B 配置</span>
              </Space>
            }
          >
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(strategyB.config, null, 2)}
            </pre>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

// ==================== 主组件 ====================

const StrategyDiffPage: React.FC = () => {
  const [form] = Form.useForm();
  const [resultData, setResultData] = useState<StrategyDiffResult | null>(null);

  const mutation = useStrategyDiff({
    onSuccess: (data) => setResultData(data),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setResultData(null);
      mutation.mutate({
        userId: values.userId,
        strategyIdA: values.strategyIdA,
        strategyIdB: values.strategyIdB,
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
            <SwapOutlined />
            <span>策略对比</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="对比两个策略对同一用户的推荐结果差异，分析重叠食物、独有食物及评分分布"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12} md={5}>
              <Form.Item
                name="userId"
                label="用户 ID"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <Input placeholder="输入用户 UUID" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Form.Item
                name="strategyIdA"
                label="策略 A ID"
                rules={[{ required: true, message: '请输入策略 A ID' }]}
              >
                <Input placeholder="策略 A UUID" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Form.Item
                name="strategyIdB"
                label="策略 B ID"
                rules={[{ required: true, message: '请输入策略 B ID' }]}
              >
                <Input placeholder="策略 B UUID" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Form.Item name="mealType" label="餐次">
                <Select placeholder="默认" allowClear options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Form.Item name="goalType" label="目标">
                <Select placeholder="默认" allowClear options={goalTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={3} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<DiffOutlined />}
                  onClick={handleSubmit}
                  loading={mutation.isPending}
                  block
                  size="large"
                >
                  执行对比
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
            <Spin size="large" tip="正在执行策略对比..." />
          </div>
        </Card>
      )}

      {/* Error */}
      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          message="策略对比失败"
          description={mutation.error?.message || '请检查用户 ID 和策略 ID 是否有效'}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Result */}
      {resultData && <DiffResultDisplay result={resultData} />}

      {/* Empty state */}
      {!mutation.isPending && !resultData && !mutation.isError && (
        <Card>
          <Empty description="输入用户 ID 和两个策略 ID，点击「执行对比」查看推荐差异" />
        </Card>
      )}
    </div>
  );
};

export default StrategyDiffPage;
