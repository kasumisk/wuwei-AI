import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Row,
  Col,
  Descriptions,
  Tag,
  Spin,
  Empty,
  Alert,
  Space,
  Typography,
  Table,
  Progress,
  Tabs,
  Tooltip,
  Badge,
  Statistic,
} from 'antd';
import {
  PlayCircleOutlined,
  ClockCircleOutlined,
  UserOutlined,
  FireOutlined,
  StarOutlined,
  BulbOutlined,
  WarningOutlined,
  CheckCircleOutlined,
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
  Legend,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useSimulateRecommend,
  type SimulateRecommendResult,
} from '@/services/recommendDebugService';

const { Text } = Typography;

export const routeConfig = {
  name: 'recommend-simulate',
  title: '模拟推荐',
  icon: 'PlayCircleOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const mealTypeOptions = [
  { label: '早餐 (breakfast)', value: 'breakfast' },
  { label: '午餐 (lunch)', value: 'lunch' },
  { label: '晚餐 (dinner)', value: 'dinner' },
  { label: '加餐 (snack)', value: 'snack' },
];

const goalTypeOptions = [
  { label: '使用用户档案默认', value: '' },
  { label: '减脂 (fat_loss)', value: 'fat_loss' },
  { label: '增肌 (muscle_gain)', value: 'muscle_gain' },
  { label: '健康 (health)', value: 'health' },
  { label: '习惯养成 (habit)', value: 'habit' },
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

const categoryLabels: Record<string, { text: string; color: string }> = {
  protein: { text: '蛋白质', color: 'red' },
  veggie: { text: '蔬菜', color: 'green' },
  grain: { text: '谷物', color: 'orange' },
  composite: { text: '复合菜', color: 'blue' },
  dairy: { text: '乳制品', color: 'cyan' },
  fruit: { text: '水果', color: 'lime' },
  snack: { text: '零食', color: 'purple' },
};

// ==================== 工具函数 ====================

const scoreColor = (score: number): string => {
  if (score >= 0.8) return '#52c41a';
  if (score >= 0.6) return '#1677ff';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
};

const scorePercent = (score: number): number => Math.round(score * 100);

// ==================== 食物评分雷达图 ====================

const FoodScoreRadar: React.FC<{ explanation: Record<string, unknown> }> = ({ explanation }) => {
  const dims = (explanation as any)?.dimensions;
  if (!dims) return <Text type="secondary">无评分维度数据</Text>;

  const radarData = Object.entries(dims)
    .filter(([, val]) => val != null)
    .map(([key, val]) => ({
      dimension: dimensionLabels[key] || key,
      raw: Math.round(((val as any).raw ?? 0) * 100),
      weighted: Math.round(((val as any).weighted ?? 0) * 100),
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={radarData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Radar name="原始分" dataKey="raw" stroke="#8884d8" fill="#8884d8" fillOpacity={0.15} />
        <Radar
          name="加权分"
          dataKey="weighted"
          stroke="#1677ff"
          fill="#1677ff"
          fillOpacity={0.25}
        />
        <Legend />
      </RadarChart>
    </ResponsiveContainer>
  );
};

// ==================== 食物修正因子 ====================

const BoostFactors: React.FC<{ explanation: Record<string, unknown> }> = ({ explanation }) => {
  const exp = explanation as any;
  if (!exp) return null;

  const factors = [
    { key: 'preferenceBoost', label: '偏好', value: exp.preferenceBoost },
    { key: 'profileBoost', label: '画像匹配', value: exp.profileBoost },
    { key: 'regionalBoost', label: '地域', value: exp.regionalBoost },
    { key: 'explorationMultiplier', label: '探索(Thompson)', value: exp.explorationMultiplier },
    { key: 'cfBoost', label: '协同过滤', value: exp.cfBoost },
    { key: 'shortTermBoost', label: '短期行为', value: exp.shortTermBoost },
    { key: 'sceneBoost', label: '场景', value: exp.sceneBoost },
    { key: 'analysisBoost', label: '分析画像', value: exp.analysisBoost },
    { key: 'lifestyleBoost', label: '生活方式', value: exp.lifestyleBoost },
    { key: 'foodPrefBoost', label: '食物偏好', value: exp.foodPrefBoost },
    { key: 'popularityBoost', label: '热门', value: exp.popularityBoost },
    { key: 'replacementBoost', label: '替换反馈', value: exp.replacementBoost },
    { key: 'compatibilityBonus', label: '搭配', value: exp.compatibilityBonus },
    { key: 'similarityPenalty', label: '去重', value: exp.similarityPenalty },
  ].filter((f) => f.value != null && f.value !== 0 && f.value !== 1);

  if (factors.length === 0) return <Text type="secondary">无修正因子</Text>;

  const barData = factors.map((f) => ({
    name: f.label,
    value: typeof f.value === 'number' ? parseFloat((f.value * 100).toFixed(1)) : 0,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(180, factors.length * 28)}>
        <BarChart data={barData} layout="vertical" margin={{ left: 60, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
          <RechartsTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
          <Bar dataKey="value" name="因子值(%)" fill="#1677ff" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 8 }}>
        <Space wrap size={[4, 4]}>
          {exp.novaPenalty != null && exp.novaPenalty !== 1 && (
            <Tag color="red">NOVA惩罚: {(exp.novaPenalty * 100).toFixed(0)}%</Tag>
          )}
          {exp.addedSugarPenalty != null && exp.addedSugarPenalty !== 0 && (
            <Tag color="red">添加糖: {exp.addedSugarPenalty}</Tag>
          )}
          {exp.confidenceFactor != null && (
            <Tag color={exp.confidenceFactor >= 0.9 ? 'green' : 'orange'}>
              置信度: {(exp.confidenceFactor * 100).toFixed(0)}%
            </Tag>
          )}
          {exp.penaltyResult?.vetoed && <Tag color="error">已否决</Tag>}
          {exp.penaltyResult?.reasons?.length > 0 &&
            exp.penaltyResult.reasons.map((r: string, i: number) => (
              <Tag key={i} color="volcano">
                {r}
              </Tag>
            ))}
        </Space>
      </div>
    </div>
  );
};

// ==================== 推荐食物卡片列表 ====================

const FoodCardList: React.FC<{ foods: any[] }> = ({ foods }) => {
  if (!foods || foods.length === 0) {
    return <Empty description="无推荐食物" />;
  }

  const columns: ColumnsType<any> = [
    {
      title: '#',
      key: 'index',
      width: 40,
      render: (_, __, idx) => (
        <Badge count={idx + 1} style={{ backgroundColor: idx === 0 ? '#52c41a' : '#1677ff' }} />
      ),
    },
    {
      title: '食物名称',
      key: 'name',
      width: 160,
      render: (_, record) => {
        const food = record.food || {};
        const cat = categoryLabels[food.category] || {
          text: food.category || '-',
          color: 'default',
        };
        return (
          <Space direction="vertical" size={0}>
            <Text strong>{food.name || '-'}</Text>
            <Space size={4}>
              <Tag color={cat.color} style={{ fontSize: 11 }}>
                {cat.text}
              </Tag>
              {food.cuisine && (
                <Tag style={{ fontSize: 11 }} color="default">
                  {food.cuisine}
                </Tag>
              )}
            </Space>
          </Space>
        );
      },
    },
    {
      title: '综合评分',
      key: 'score',
      width: 120,
      sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0),
      defaultSortOrder: 'descend',
      render: (_, record) => (
        <Space>
          <Progress
            type="circle"
            percent={scorePercent(record.score ?? 0)}
            size={40}
            strokeColor={scoreColor(record.score ?? 0)}
            format={(p) => `${p}`}
          />
          <Text style={{ fontSize: 11, color: '#999' }}>
            {((record.score ?? 0) * 100).toFixed(1)}
          </Text>
        </Space>
      ),
    },
    {
      title: '每份营养',
      key: 'nutrition',
      width: 200,
      render: (_, record) => (
        <Space size={4} wrap>
          <Tag icon={<FireOutlined />} color="red">
            {Math.round(record.servingCalories ?? 0)} kcal
          </Tag>
          <Tag color="blue">蛋白 {(record.servingProtein ?? 0).toFixed(1)}g</Tag>
          <Tag color="orange">脂肪 {(record.servingFat ?? 0).toFixed(1)}g</Tag>
          <Tag color="green">碳水 {(record.servingCarbs ?? 0).toFixed(1)}g</Tag>
          {record.servingFiber > 0 && (
            <Tag color="lime">纤维 {(record.servingFiber ?? 0).toFixed(1)}g</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '份量',
      key: 'serving',
      width: 100,
      render: (_, record) => {
        const food = record.food || {};
        return <Text>{food.standardServingDesc || `${food.standardServingG ?? '-'}g`}</Text>;
      },
    },
    {
      title: '最终得分',
      key: 'finalScore',
      width: 80,
      render: (_, record) => {
        const fs = record.explanation?.finalScore;
        return fs != null ? (
          <Text strong style={{ color: scoreColor(fs) }}>
            {(fs * 100).toFixed(1)}
          </Text>
        ) : (
          '-'
        );
      },
    },
  ];

  return (
    <div>
      <Table
        columns={columns}
        dataSource={foods}
        rowKey={(record, idx) => record.food?.id || idx}
        size="small"
        pagination={false}
        expandable={{
          expandedRowRender: (record) =>
            record.explanation ? (
              <Row gutter={16}>
                <Col span={12}>
                  <Card size="small" title="评分维度雷达图" bordered={false}>
                    <FoodScoreRadar explanation={record.explanation} />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" title="修正因子" bordered={false}>
                    <BoostFactors explanation={record.explanation} />
                  </Card>
                </Col>
              </Row>
            ) : (
              <Text type="secondary">该食物无详细评分数据（仅 Top-K 食物包含评分明细）</Text>
            ),
          rowExpandable: (record) => !!record.explanation,
        }}
      />
    </div>
  );
};

// ==================== 套餐组合评分 ====================

const MealCompositionCard: React.FC<{ result: any }> = ({ result }) => {
  const cs = result.compositionScore || result.mealExplanation?.compositionScore;
  if (!cs) return null;

  const items = [
    { name: '食材多样性', value: cs.ingredientDiversity },
    { name: '烹饪多样性', value: cs.cookingMethodDiversity },
    { name: '风味和谐', value: cs.flavorHarmony },
    { name: '营养互补', value: cs.nutritionComplementarity },
    { name: '口感多样', value: cs.textureDiversity },
  ].filter((d) => d.value != null);

  return (
    <Card
      size="small"
      title={
        <Space>
          <StarOutlined />
          <span>套餐组合评分</span>
          {cs.overall != null && (
            <Tag color={cs.overall >= 70 ? 'success' : cs.overall >= 50 ? 'warning' : 'error'}>
              综合: {Math.round(cs.overall)}
            </Tag>
          )}
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Row gutter={[16, 8]}>
        {items.map((item) => (
          <Col span={Math.floor(24 / Math.max(items.length, 1))} key={item.name}>
            <div style={{ textAlign: 'center' }}>
              <Progress
                type="dashboard"
                percent={Math.round(item.value)}
                size={80}
                strokeColor={scoreColor(item.value / 100)}
                format={(p) => `${p}`}
              />
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{item.name}</div>
            </div>
          </Col>
        ))}
      </Row>
      {result.mealExplanation?.summary && (
        <Alert
          message={result.mealExplanation.summary}
          type="info"
          showIcon
          icon={<BulbOutlined />}
          style={{ marginTop: 12 }}
        />
      )}
      {result.mealExplanation?.complementaryPairs?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            营养互补对:
          </Text>
          <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
            {result.mealExplanation.complementaryPairs.map((pair: any, i: number) => (
              <Tooltip key={i} title={pair.benefit}>
                <Tag color="processing">
                  {pair.foodA}({pair.nutrientA}) + {pair.foodB}({pair.nutrientB})
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </div>
      )}
      {result.mealExplanation?.diversityTips?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {result.mealExplanation.diversityTips.map((tip: string, i: number) => (
            <Tag key={i} color="warning" style={{ marginBottom: 4 }}>
              {tip}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  );
};

// ==================== 结构化洞察 ====================

const InsightsCard: React.FC<{ insights: any[] }> = ({ insights }) => {
  if (!insights || insights.length === 0) return null;

  return (
    <Card
      size="small"
      title={
        <Space>
          <BulbOutlined />
          <span>结构化洞察</span>
          <Tag>{insights.length} 条</Tag>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {insights
          .sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0))
          .map((insight: any, i: number) => (
            <Alert
              key={i}
              message={
                <Space>
                  <Tag color="processing">{insight.type}</Tag>
                  <Text>{insight.contentKey}</Text>
                  {insight.importance != null && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      重要度: {(insight.importance * 100).toFixed(0)}%
                    </Text>
                  )}
                </Space>
              }
              type="info"
              showIcon={false}
            />
          ))}
      </Space>
    </Card>
  );
};

// ==================== 降级记录 ====================

const DegradationsCard: React.FC<{ degradations: any[] }> = ({ degradations }) => {
  if (!degradations || degradations.length === 0) return null;

  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      message={`推荐管线降级 (${degradations.length} 处)`}
      description={
        <Space direction="vertical" size={4}>
          {degradations.map((d: any, i: number) => (
            <div key={i}>
              <Tag color="warning">{d.stage}</Tag>
              <Text>{d.reason}</Text>
              {d.fallbackUsed && <Text type="secondary"> → 回退: {d.fallbackUsed}</Text>}
            </div>
          ))}
        </Space>
      }
      style={{ marginBottom: 16 }}
    />
  );
};

// ==================== 结果展示组件（增强版） ====================

const ResultDisplay: React.FC<{ result: SimulateRecommendResult }> = ({ result }) => {
  const { input, performance, note } = result;
  const res = result.result as any;

  // 解析推荐结果
  const foods: any[] = res?.foods || [];
  const candidates: any[] = res?.candidates || [];

  return (
    <div>
      {/* 性能 + 概要指标行 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Statistic
              title="推荐耗时"
              value={performance.elapsedMs}
              suffix="ms"
              valueStyle={{ color: performance.elapsedMs <= 200 ? '#52c41a' : '#faad14' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Statistic
              title="推荐食物"
              value={foods.length}
              suffix="种"
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Statistic
              title="总热量"
              value={res?.totalCalories ?? '-'}
              suffix="kcal"
              prefix={<FireOutlined />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Statistic title="总蛋白质" value={res?.totalProtein ?? '-'} suffix="g" />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Statistic title="候选池" value={candidates.length} suffix="种" />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small">
            <Space direction="vertical" size={0}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                目标/餐次
              </Text>
              <Space size={4}>
                <Tag color="blue">{result.goalType}</Tag>
                <Tag color="green">{result.mealType}</Tag>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      {note && <Alert message={note} type="warning" showIcon style={{ marginBottom: 16 }} />}

      {/* 降级警告 */}
      <DegradationsCard degradations={res?.degradations} />

      {/* 主推荐展示文本 */}
      {res?.displayText && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={
            <Space direction="vertical" size={0}>
              <Text strong>推荐方案</Text>
              <Text>{res.displayText}</Text>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 套餐组合评分 */}
      <MealCompositionCard result={res} />

      {/* 主 Tabs */}
      <Tabs
        type="card"
        items={[
          {
            key: 'foods',
            label: `推荐食物 (${foods.length})`,
            children: <FoodCardList foods={foods} />,
          },
          ...(candidates.length > 0
            ? [
                {
                  key: 'candidates',
                  label: `候选池 (${candidates.length})`,
                  children: <FoodCardList foods={candidates} />,
                },
              ]
            : []),
          {
            key: 'context',
            label: '输入上下文',
            children: (
              <Card size="small">
                <Row gutter={16}>
                  <Col span={12}>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="已摄入热量">
                        {input.consumed.calories} kcal
                      </Descriptions.Item>
                      <Descriptions.Item label="已摄入蛋白质">
                        {input.consumed.protein} g
                      </Descriptions.Item>
                      <Descriptions.Item label="每日热量目标">
                        {input.dailyTarget.calories} kcal
                      </Descriptions.Item>
                      <Descriptions.Item label="每日蛋白质目标">
                        {input.dailyTarget.protein} g
                      </Descriptions.Item>
                    </Descriptions>
                  </Col>
                  <Col span={12}>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="餐次热量目标">
                        {input.target.calories} kcal
                      </Descriptions.Item>
                      <Descriptions.Item label="餐次蛋白质">
                        {input.target.protein} g
                      </Descriptions.Item>
                      <Descriptions.Item label="餐次脂肪">{input.target.fat} g</Descriptions.Item>
                      <Descriptions.Item label="餐次碳水">{input.target.carbs} g</Descriptions.Item>
                    </Descriptions>
                  </Col>
                </Row>
                {input.userProfile && (
                  <div style={{ marginTop: 12 }}>
                    <Space wrap>
                      {input.userProfile.allergens?.length > 0 && (
                        <span>
                          过敏原:{' '}
                          {input.userProfile.allergens.map((a) => (
                            <Tag key={a} color="red">
                              {a}
                            </Tag>
                          ))}
                        </span>
                      )}
                      {input.userProfile.dietaryRestrictions?.length > 0 && (
                        <span>
                          饮食限制:{' '}
                          {input.userProfile.dietaryRestrictions.map((d) => (
                            <Tag key={d} color="orange">
                              {d}
                            </Tag>
                          ))}
                        </span>
                      )}
                      {input.userProfile.healthConditions?.length > 0 && (
                        <span>
                          健康状况:{' '}
                          {input.userProfile.healthConditions.map((h) => (
                            <Tag key={h} color="purple">
                              {h}
                            </Tag>
                          ))}
                        </span>
                      )}
                      {input.userProfile.regionCode && (
                        <span>
                          地区: <Tag>{input.userProfile.regionCode}</Tag>
                        </span>
                      )}
                    </Space>
                  </div>
                )}
              </Card>
            ),
          },
          ...(res?.recipes?.length > 0
            ? [
                {
                  key: 'recipes',
                  label: `食谱 (${res.recipes.length})`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {res.recipes.map((recipe: any, i: number) => (
                        <Card
                          key={i}
                          size="small"
                          title={
                            <Space>
                              <Text strong>{recipe.name}</Text>
                              {recipe.isAssembled && <Tag color="blue">自动组装</Tag>}
                              <Tag color="green">
                                评分: {((recipe.recipeScore ?? 0) * 100).toFixed(0)}
                              </Tag>
                            </Space>
                          }
                        >
                          <Row gutter={16}>
                            <Col span={6}>
                              <Text type="secondary">热量</Text>
                              <br />
                              <Text strong>{Math.round(recipe.totalCalories)} kcal</Text>
                            </Col>
                            <Col span={6}>
                              <Text type="secondary">蛋白质</Text>
                              <br />
                              <Text strong>{(recipe.totalProtein ?? 0).toFixed(1)}g</Text>
                            </Col>
                            <Col span={6}>
                              <Text type="secondary">烹饪时间</Text>
                              <br />
                              <Text strong>{recipe.estimatedCookTime ?? '-'} 分钟</Text>
                            </Col>
                            <Col span={6}>
                              <Text type="secondary">难度</Text>
                              <br />
                              <Tag>{recipe.skillLevel || '-'}</Tag>
                            </Col>
                          </Row>
                          {recipe.ingredients?.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <Text type="secondary">食材: </Text>
                              <Space wrap size={4}>
                                {recipe.ingredients.map((ing: any, j: number) => (
                                  <Tag key={j}>{ing.food?.name || '未知'}</Tag>
                                ))}
                              </Space>
                            </div>
                          )}
                        </Card>
                      ))}
                    </Space>
                  ),
                },
              ]
            : []),
          ...(res?.insights?.length > 0
            ? [
                {
                  key: 'insights',
                  label: `洞察 (${res.insights.length})`,
                  children: <InsightsCard insights={res.insights} />,
                },
              ]
            : []),
          {
            key: 'raw',
            label: '原始 JSON',
            children: (
              <Card size="small">
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 6,
                    maxHeight: 600,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </Card>
            ),
          },
        ]}
      />

      {/* 额外提示信息 */}
      {(res?.tip || res?.goalProgressTip || res?.phaseTransitionHint || res?.planTheme) && (
        <Card size="small" title="提示信息" style={{ marginTop: 16 }}>
          <Space direction="vertical" size={4}>
            {res.planTheme && (
              <Text>
                主题: <Tag color="processing">{res.planTheme}</Tag>
              </Text>
            )}
            {res.executionDifficulty != null && (
              <Text>
                执行难度:{' '}
                <Progress
                  percent={Math.round(res.executionDifficulty * 100)}
                  size="small"
                  style={{ width: 200, display: 'inline-flex' }}
                />
              </Text>
            )}
            {res.tip && <Alert message={res.tip} type="info" showIcon />}
            {res.goalProgressTip && <Alert message={res.goalProgressTip} type="success" showIcon />}
            {res.phaseTransitionHint && (
              <Alert message={res.phaseTransitionHint} type="warning" showIcon />
            )}
          </Space>
        </Card>
      )}
    </div>
  );
};

// ==================== 主组件 ====================

const SimulatePage: React.FC = () => {
  const [form] = Form.useForm();
  const [resultData, setResultData] = useState<SimulateRecommendResult | null>(null);

  const mutation = useSimulateRecommend({
    onSuccess: (data) => setResultData(data),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setResultData(null);
      mutation.mutate({
        userId: values.userId,
        mealType: values.mealType,
        goalType: values.goalType || undefined,
        consumedCalories: values.consumedCalories ?? undefined,
        consumedProtein: values.consumedProtein ?? undefined,
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
            <PlayCircleOutlined />
            <span>模拟推荐</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="模拟推荐为只读操作，不会产生任何副作用（不保存记录、不影响用户数据）"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="userId"
                label="用户 ID"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="输入用户 UUID" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="mealType"
                label="餐次类型"
                rules={[{ required: true, message: '请选择餐次类型' }]}
              >
                <Select placeholder="选择餐次" options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="goalType" label="目标类型覆盖">
                <Select placeholder="使用用户档案默认" allowClear options={goalTypeOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="consumedCalories" label="已摄入热量 (kcal)">
                <InputNumber min={0} max={10000} style={{ width: '100%' }} placeholder="默认 0" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="consumedProtein" label="已摄入蛋白质 (g)">
                <InputNumber min={0} max={1000} style={{ width: '100%' }} placeholder="默认 0" />
              </Form.Item>
            </Col>
            <Col span={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleSubmit}
                  loading={mutation.isPending}
                  block
                  size="large"
                >
                  执行模拟推荐
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 结果展示 */}
      {mutation.isPending && (
        <Card>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" tip="正在执行推荐引擎..." />
          </div>
        </Card>
      )}

      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          message="模拟推荐失败"
          description={mutation.error?.message || '请检查用户 ID 是否有效'}
          style={{ marginBottom: 16 }}
        />
      )}

      {resultData && <ResultDisplay result={resultData} />}

      {!mutation.isPending && !resultData && !mutation.isError && (
        <Card>
          <Empty description="输入参数并点击「执行模拟推荐」查看结果" />
        </Card>
      )}
    </div>
  );
};

export default SimulatePage;
