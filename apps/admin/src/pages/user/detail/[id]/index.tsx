import React, { useState } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Spin,
  Typography,
  Button,
  Space,
  Tabs,
  Table,
  Empty,
  Progress,
  Row,
  Col,
  Statistic,
  Avatar,
  Badge,
} from 'antd';
import {
  ArrowLeftOutlined,
  UserOutlined,
  HeartOutlined,
  LineChartOutlined,
  HistoryOutlined,
  FireOutlined,
  TrophyOutlined,
  CrownOutlined,
  CoffeeOutlined,
  LikeOutlined,
  ThunderboltOutlined,
  SwapOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useBehaviorProfile,
  useInferredProfile,
  type BehaviorProfileDto,
  type DeclaredProfileDto,
  type InferredProfileDto,
  type ProfileChangeLogDto,
} from '@/services/appUserManagementService';
import { contentApi, type FoodRecordDto } from '@/services/contentManagementService';
import {
  useSubscriptions,
  usePaymentRecords,
  type PaymentRecordDto,
} from '@/services/subscriptionManagementService';
import { useUserStrategy } from '@/services/recommendDebugService';
import { useQuery } from '@tanstack/react-query';

// ==================== 常量映射 ====================

const goalLabels: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '保持健康',
  habit: '改善习惯',
};

const goalSpeedLabels: Record<string, string> = {
  aggressive: '快速',
  steady: '稳定',
  relaxed: '佛系',
};

const activityLabels: Record<string, string> = {
  sedentary: '久坐',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高度活动',
};

const disciplineLabels: Record<string, string> = {
  high: '很强',
  medium: '一般',
  low: '容易放弃',
};

const trendLabels: Record<string, { text: string; color: string }> = {
  losing: { text: '下降中', color: '#52c41a' },
  gaining: { text: '上升中', color: '#ff4d4f' },
  plateau: { text: '平台期', color: '#faad14' },
  fluctuating: { text: '波动中', color: '#1677ff' },
};

// ==================== 子组件: 行为画像 ====================

const BehaviorProfileTab: React.FC<{
  behavior: BehaviorProfileDto | null;
  declared: DeclaredProfileDto | null;
}> = ({ behavior, declared }) => {
  if (!behavior && !declared) {
    return <Empty description="暂无画像数据" />;
  }

  return (
    <div>
      {/* 行为统计卡片 */}
      {behavior && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="依从率"
                value={(Number(behavior.avgComplianceRate) * 100).toFixed(0)}
                suffix="%"
                valueStyle={{
                  color: Number(behavior.avgComplianceRate) >= 0.7 ? '#52c41a' : '#faad14',
                }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="总记录数" value={behavior.totalRecords} prefix={<FireOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="健康记录"
                value={behavior.healthyRecords}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="当前连续"
                value={behavior.streakDays}
                suffix="天"
                prefix={<TrophyOutlined />}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="最长连续" value={behavior.longestStreak} suffix="天" />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="教练风格" value={behavior.coachStyle} />
            </Card>
          </Col>
        </Row>
      )}

      {/* 行为画像详情 */}
      {behavior && (
        <Card title="行为画像" size="small" style={{ marginBottom: 16 }}>
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="喜爱食物">
              {behavior.foodPreferences?.loves?.length ? (
                <Space wrap>
                  {behavior.foodPreferences.loves.map((f) => (
                    <Tag key={f} color="green">
                      {f}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="回避食物">
              {behavior.foodPreferences?.avoids?.length ? (
                <Space wrap>
                  {behavior.foodPreferences.avoids.map((f) => (
                    <Tag key={f} color="red">
                      {f}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="常吃食物">
              {behavior.foodPreferences?.frequentFoods?.length ? (
                <Space wrap>
                  {behavior.foodPreferences.frequentFoods.map((f) => (
                    <Tag key={f}>{f}</Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="份量倾向">{behavior.portionTendency}</Descriptions.Item>
            <Descriptions.Item label="暴食风险时段">
              {behavior.bingeRiskHours?.length ? (
                <Space wrap>
                  {behavior.bingeRiskHours.map((h) => (
                    <Tag key={h} color="warning">
                      {h}:00
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="失败触发因素">
              {behavior.failureTriggers?.length ? (
                <Space wrap>
                  {behavior.failureTriggers.map((t) => (
                    <Tag key={t} color="orange">
                      {t}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="用餐时间" span={2}>
              {Object.entries(behavior.mealTimingPatterns || {}).map(([meal, time]) => (
                <Tag key={meal}>
                  {meal === 'breakfast'
                    ? '早餐'
                    : meal === 'lunch'
                      ? '午餐'
                      : meal === 'dinner'
                        ? '晚餐'
                        : '加餐'}
                  : {time as string}
                </Tag>
              ))}
              {!Object.keys(behavior.mealTimingPatterns || {}).length && (
                <span style={{ color: '#bbb' }}>暂无</span>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 声明档案 */}
      {declared && (
        <Card title="声明档案（用户填写）" size="small">
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="目标">
              <Tag color="blue">{goalLabels[declared.goal] || declared.goal}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="目标速度">
              {goalSpeedLabels[declared.goalSpeed] || declared.goalSpeed}
            </Descriptions.Item>
            <Descriptions.Item label="性别">{declared.gender || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="出生年份">{declared.birthYear || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="身高">
              {declared.heightCm ? `${declared.heightCm} cm` : '未填写'}
            </Descriptions.Item>
            <Descriptions.Item label="体重">
              {declared.weightKg ? `${declared.weightKg} kg` : '未填写'}
            </Descriptions.Item>
            <Descriptions.Item label="目标体重">
              {declared.targetWeightKg ? `${declared.targetWeightKg} kg` : '未填写'}
            </Descriptions.Item>
            <Descriptions.Item label="活动等级">
              {activityLabels[declared.activityLevel] || declared.activityLevel}
            </Descriptions.Item>
            <Descriptions.Item label="自律程度">
              {disciplineLabels[declared.discipline] || declared.discipline}
            </Descriptions.Item>
            <Descriptions.Item label="每日餐数">{declared.mealsPerDay}餐</Descriptions.Item>
            <Descriptions.Item label="外卖频率">{declared.takeoutFrequency}</Descriptions.Item>
            <Descriptions.Item label="会做饭">{declared.canCook ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="饮食偏好" span={2}>
              {declared.foodPreferences?.length ? (
                <Space wrap>
                  {declared.foodPreferences.map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </Space>
              ) : (
                '无'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="忌口" span={2}>
              {declared.dietaryRestrictions?.length ? (
                <Space wrap>
                  {declared.dietaryRestrictions.map((r) => (
                    <Tag key={r} color="red">
                      {r}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '无'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="过敏原" span={2}>
              {declared.allergens?.length ? (
                <Space wrap>
                  {declared.allergens.map((a) => (
                    <Tag key={a} color="error">
                      {a}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '无'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="健康状况" span={2}>
              {declared.healthConditions?.length ? (
                <Space wrap>
                  {declared.healthConditions.map((h) => (
                    <Tag key={h} color="warning">
                      {h}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '无'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="数据完整度">
              <Progress
                percent={Math.round(Number(declared.dataCompleteness) * 100)}
                size="small"
                style={{ width: 120 }}
              />
            </Descriptions.Item>
            <Descriptions.Item label="引导完成">
              <Tag color={declared.onboardingCompleted ? 'success' : 'default'}>
                {declared.onboardingCompleted ? '已完成' : '未完成'}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </div>
  );
};

// ==================== 子组件: 推断画像 ====================

const InferredProfileTab: React.FC<{ inferred: InferredProfileDto | null }> = ({ inferred }) => {
  if (!inferred) {
    return <Empty description="暂无推断画像数据" />;
  }

  const gp = inferred.goalProgress || {};
  const trend = gp.trend ? trendLabels[gp.trend] : null;

  return (
    <div>
      {/* 核心指标 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="BMR" value={inferred.estimatedBMR || '-'} suffix="kcal" />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="TDEE" value={inferred.estimatedTDEE || '-'} suffix="kcal" />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="推荐热量"
              value={inferred.recommendedCalories || '-'}
              suffix="kcal"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="用户分群" value={inferred.userSegment || '未分类'} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="流失风险"
              value={(Number(inferred.churnRisk) * 100).toFixed(0)}
              suffix="%"
              valueStyle={{
                color: Number(inferred.churnRisk) >= 0.5 ? '#ff4d4f' : '#52c41a',
              }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="最佳餐数" value={inferred.optimalMealCount || '-'} suffix="餐" />
          </Card>
        </Col>
      </Row>

      {/* 宏量素目标 */}
      <Card title="宏量素目标" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={8}>
            <Statistic title="蛋白质" value={inferred.macroTargets?.proteinG || '-'} suffix="g" />
          </Col>
          <Col span={8}>
            <Statistic title="碳水化合物" value={inferred.macroTargets?.carbG || '-'} suffix="g" />
          </Col>
          <Col span={8}>
            <Statistic title="脂肪" value={inferred.macroTargets?.fatG || '-'} suffix="g" />
          </Col>
        </Row>
      </Card>

      {/* 目标进度 */}
      {(gp.startWeight || gp.currentWeight || gp.targetWeight) && (
        <Card title="目标进度" size="small" style={{ marginBottom: 16 }}>
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="起始体重">
              {gp.startWeight ? `${gp.startWeight} kg` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="当前体重">
              {gp.currentWeight ? `${gp.currentWeight} kg` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="目标体重">
              {gp.targetWeight ? `${gp.targetWeight} kg` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="进度">
              {gp.progressPercent !== undefined ? (
                <Progress percent={Math.round(gp.progressPercent)} size="small" />
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="趋势">
              {trend ? <Tag color={trend.color}>{trend.text}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="周均变化">
              {gp.weeklyRateKg ? `${gp.weeklyRateKg} kg/周` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="预计剩余">
              {gp.estimatedWeeksLeft ? `${gp.estimatedWeeksLeft} 周` : '-'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 营养缺口 */}
      {inferred.nutritionGaps?.length > 0 && (
        <Card title="营养缺口" size="small" style={{ marginBottom: 16 }}>
          <Space wrap>
            {inferred.nutritionGaps.map((gap) => (
              <Tag key={gap} color="warning">
                {gap}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      {/* 元数据 */}
      <Card title="计算信息" size="small">
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="最后计算时间">
            {inferred.lastComputedAt
              ? new Date(inferred.lastComputedAt).toLocaleString('zh-CN')
              : '从未计算'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(inferred.updatedAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
};

// ==================== 子组件: 变更日志 ====================

const ChangeLogsTab: React.FC<{ logs: ProfileChangeLogDto[] }> = ({ logs }) => {
  if (!logs?.length) {
    return <Empty description="暂无变更日志" />;
  }

  const columns = [
    { title: '版本', dataIndex: 'version', width: 70 },
    {
      title: '类型',
      dataIndex: 'changeType',
      width: 100,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 80,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '变更字段',
      dataIndex: 'changedFields',
      width: 200,
      render: (fields: string[]) => (
        <Space wrap size={4}>
          {fields?.map((f) => (
            <Tag key={f} style={{ fontSize: 11 }}>
              {f}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <Table
      dataSource={logs}
      columns={columns}
      rowKey="id"
      size="small"
      pagination={{ pageSize: 10 }}
      expandable={{
        expandedRowRender: (record: ProfileChangeLogDto) => (
          <Row gutter={16}>
            <Col span={12}>
              <Typography.Text strong>变更前:</Typography.Text>
              <pre
                style={{
                  background: '#fff1f0',
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 11,
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(record.beforeValues, null, 2)}
              </pre>
            </Col>
            <Col span={12}>
              <Typography.Text strong>变更后:</Typography.Text>
              <pre
                style={{
                  background: '#f6ffed',
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 11,
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(record.afterValues, null, 2)}
              </pre>
            </Col>
          </Row>
        ),
      }}
    />
  );
};

// ==================== 子组件: 订阅信息（新增） ====================

const SUBSCRIPTION_STATUS_MAP: Record<string, { color: string; text: string }> = {
  active: { color: 'success', text: '生效中' },
  expired: { color: 'default', text: '已过期' },
  canceled: { color: 'warning', text: '已取消' },
  past_due: { color: 'error', text: '逾期' },
  trialing: { color: 'processing', text: '试用中' },
};

const TIER_LABELS_SUB: Record<string, string> = {
  free: '免费版',
  pro: 'Pro',
  premium: 'Premium',
};

const SubscriptionTab: React.FC<{ userId: string }> = ({ userId }) => {
  const { data: subData, isLoading: subLoading } = useSubscriptions({ pageSize: 5 });
  const { data: payData, isLoading: payLoading } = usePaymentRecords({ userId, pageSize: 10 });

  if (subLoading || payLoading) return <Spin />;

  const subs = subData?.list || [];
  const payments = payData?.list || [];

  if (!subs.length && !payments.length) {
    return <Empty description="该用户暂无订阅记录" />;
  }

  const subColumns = [
    {
      title: '套餐',
      dataIndex: 'tier',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'premium' ? 'purple' : v === 'pro' ? 'blue' : 'default'}>
          {TIER_LABELS_SUB[v] || v}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const cfg = SUBSCRIPTION_STATUS_MAP[v] || { color: 'default', text: v };
        return <Badge status={cfg.color as any} text={cfg.text} />;
      },
    },
    {
      title: '计费周期',
      dataIndex: 'billingCycle',
      width: 100,
      render: (v: string) =>
        v === 'monthly' ? '月付' : v === 'yearly' ? '年付' : v === 'lifetime' ? '终身' : v,
    },
    {
      title: '支付渠道',
      dataIndex: 'paymentChannel',
      width: 120,
    },
    {
      title: '开始时间',
      dataIndex: 'startDate',
      width: 120,
      render: (v: string) => (v ? new Date(v).toLocaleDateString('zh-CN') : '-'),
    },
    {
      title: '到期时间',
      dataIndex: 'endDate',
      width: 120,
      render: (v: string) => (v ? new Date(v).toLocaleDateString('zh-CN') : '-'),
    },
  ];

  const payColumns = [
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      render: (v: number, record: PaymentRecordDto) =>
        `${record.currency?.toUpperCase() || ''} ${(v / 100).toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'succeeded' ? 'success' : v === 'pending' ? 'processing' : 'error'}>
          {v}
        </Tag>
      ),
    },
    { title: '渠道', dataIndex: 'paymentChannel', width: 100 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div>
      <Card title="订阅记录" size="small" style={{ marginBottom: 16 }}>
        <Table dataSource={subs} columns={subColumns} rowKey="id" size="small" pagination={false} />
      </Card>
      {payments.length > 0 && (
        <Card title="支付记录" size="small">
          <Table
            dataSource={payments}
            columns={payColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5, size: 'small' }}
          />
        </Card>
      )}
    </div>
  );
};

// ==================== 子组件: 饮食记录（新增） ====================

const MEAL_LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

const FoodRecordsTab: React.FC<{ userId: string }> = ({ userId }) => {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['userFoodRecords', userId, page],
    queryFn: () => contentApi.getFoodRecords({ userId, page, pageSize: 10 }),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return <Spin />;
  if (!data?.list?.length) return <Empty description="该用户暂无饮食记录" />;

  const columns = [
    {
      title: '餐类',
      dataIndex: 'mealType',
      width: 80,
      render: (v: string) => <Tag>{MEAL_LABELS[v] || v}</Tag>,
    },
    {
      title: '食物',
      dataIndex: 'foods',
      render: (foods: FoodRecordDto['foods']) => (
        <Space wrap size={4}>
          {foods?.map((f, i) => (
            <Tag key={i}>
              {f.name} ({f.calories}kcal)
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '总热量',
      dataIndex: 'totalCalories',
      width: 100,
      render: (v: number) => <Typography.Text strong>{v} kcal</Typography.Text>,
    },
    {
      title: '营养分',
      dataIndex: 'nutritionScore',
      width: 80,
      render: (v: number) => (
        <Tag color={v >= 80 ? 'success' : v >= 60 ? 'warning' : 'error'}>{v}</Tag>
      ),
    },
    {
      title: '决策',
      dataIndex: 'decision',
      width: 80,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '风险',
      dataIndex: 'riskLevel',
      width: 80,
      render: (v: string) =>
        v ? (
          <Tag color={v === 'high' ? 'error' : v === 'medium' ? 'warning' : 'success'}>{v}</Tag>
        ) : (
          '-'
        ),
    },
    {
      title: '时间',
      dataIndex: 'recordedAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <Table
      dataSource={data.list}
      columns={columns}
      rowKey="id"
      size="small"
      pagination={{
        current: page,
        total: data.total,
        pageSize: 10,
        size: 'small',
        onChange: setPage,
        showTotal: (t) => `共 ${t} 条`,
      }}
    />
  );
};

// ==================== 子组件: 推荐反馈（新增） ====================

const ACTION_CONFIG: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
  accept: { color: 'success', icon: <CheckCircleOutlined />, text: '接受' },
  replace: { color: 'warning', icon: <SwapOutlined />, text: '替换' },
  skip: { color: 'error', icon: <StopOutlined />, text: '跳过' },
};

const RecommendFeedbackTab: React.FC<{ userId: string }> = ({ userId }) => {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['userRecommendFeedback', userId, page],
    queryFn: () => contentApi.getRecommendationFeedback({ userId, page, pageSize: 10 }),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return <Spin />;
  if (!data?.list?.length) return <Empty description="该用户暂无推荐反馈" />;

  // 计算简要统计
  const all = data.list;
  const acceptCount = all.filter((r) => r.action === 'accept').length;
  const replaceCount = all.filter((r) => r.action === 'replace').length;
  const skipCount = all.filter((r) => r.action === 'skip').length;

  const columns = [
    {
      title: '餐类',
      dataIndex: 'mealType',
      width: 80,
      render: (v: string) => <Tag>{MEAL_LABELS[v] || v}</Tag>,
    },
    {
      title: '推荐食物',
      dataIndex: 'foodName',
      width: 160,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 80,
      render: (v: string) => {
        const cfg = ACTION_CONFIG[v] || { color: 'default', icon: null, text: v };
        return (
          <Tag icon={cfg.icon} color={cfg.color}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '替换食物',
      dataIndex: 'replacementFood',
      width: 140,
      render: (v: string | undefined) => v || '-',
    },
    {
      title: '推荐分',
      dataIndex: 'recommendationScore',
      width: 80,
      render: (v: number | undefined) => (v !== undefined ? v.toFixed(2) : '-'),
    },
    {
      title: '目标',
      dataIndex: 'goalType',
      width: 80,
      render: (v: string | undefined) => (v ? <Tag color="blue">{goalLabels[v] || v}</Tag> : '-'),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="接受"
              value={acceptCount}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="替换"
              value={replaceCount}
              prefix={<SwapOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="跳过"
              value={skipCount}
              prefix={<StopOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>
      <Table
        dataSource={data.list}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{
          current: page,
          total: data.total,
          pageSize: 10,
          size: 'small',
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
    </div>
  );
};

// ==================== 子组件: 策略信息（新增） ====================

const StrategyTab: React.FC<{ userId: string }> = ({ userId }) => {
  const { data, isLoading } = useUserStrategy(userId);

  if (isLoading) return <Spin />;
  if (!data) return <Empty description="该用户暂无策略分配" />;

  const { resolvedStrategy, experimentAssignment, experimentStrategy } = data;

  return (
    <div>
      {/* 当前策略概要 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="目标类型" value={goalLabels[data.goalType] || data.goalType} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="有画像" value={data.hasProfile ? '是' : '否'} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="实验分组" value={experimentAssignment?.groupName || '无实验'} />
          </Card>
        </Col>
      </Row>

      {/* 已解析策略 */}
      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>当前生效策略</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="策略名称">
            <Typography.Text strong>{resolvedStrategy.strategyName}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="策略 ID">
            <Typography.Text copyable style={{ fontSize: 11 }}>
              {resolvedStrategy.strategyId}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            <Space wrap>
              {resolvedStrategy.sources.map((s) => (
                <Tag key={s} color="blue">
                  {s}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="解析时间">
            {new Date(resolvedStrategy.resolvedAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>

        <Card title="策略配置" size="small" type="inner" style={{ marginTop: 12 }}>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 8,
              borderRadius: 4,
              fontSize: 11,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(resolvedStrategy.config, null, 2)}
          </pre>
        </Card>
      </Card>

      {/* 实验分配 */}
      {experimentAssignment && (
        <Card
          title={
            <Space>
              <FireOutlined />
              <span>实验分配</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="实验名称">
              {experimentAssignment.experimentName}
            </Descriptions.Item>
            <Descriptions.Item label="实验 ID">
              <Typography.Text copyable style={{ fontSize: 11 }}>
                {experimentAssignment.experimentId}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="分组">
              <Tag color="green">{experimentAssignment.groupName}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="评分权重覆盖">
              {experimentAssignment.scoreWeightOverrides ? (
                <pre style={{ fontSize: 11, margin: 0 }}>
                  {JSON.stringify(experimentAssignment.scoreWeightOverrides, null, 2)}
                </pre>
              ) : (
                <span style={{ color: '#bbb' }}>无覆盖</span>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 实验策略（如有） */}
      {experimentStrategy && (
        <Card title="实验策略配置" size="small">
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="实验 ID">{experimentStrategy.experimentId}</Descriptions.Item>
            <Descriptions.Item label="分组">{experimentStrategy.groupName}</Descriptions.Item>
          </Descriptions>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 8,
              borderRadius: 4,
              fontSize: 11,
              maxHeight: 200,
              overflow: 'auto',
              marginTop: 8,
            }}
          >
            {JSON.stringify(experimentStrategy.config, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
};

// ==================== 主组件 ====================

const UserDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: behaviorData, isLoading: behaviorLoading } = useBehaviorProfile(id!, !!id);
  const { data: inferredData, isLoading: inferredLoading } = useInferredProfile(id!, !!id);

  const isLoading = behaviorLoading || inferredLoading;
  const userInfo = behaviorData?.user || inferredData?.user;

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  // 合并两个接口的变更日志
  const allChangeLogs = [
    ...(behaviorData?.recentChangeLogs || []),
    ...(inferredData?.recentChangeLogs || []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      {/* 头部 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/user')}>
            返回用户列表
          </Button>
          <Avatar size={36} src={undefined} icon={<UserOutlined />} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {userInfo?.nickname || '匿名用户'}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {id}
            </Typography.Text>
          </div>
        </Space>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs
          defaultActiveKey="behavior"
          items={[
            {
              key: 'behavior',
              label: (
                <span>
                  <HeartOutlined /> 行为画像
                </span>
              ),
              children: (
                <BehaviorProfileTab
                  behavior={behaviorData?.behaviorProfile || null}
                  declared={behaviorData?.declaredProfile || null}
                />
              ),
            },
            {
              key: 'inferred',
              label: (
                <span>
                  <LineChartOutlined /> 推断画像
                </span>
              ),
              children: <InferredProfileTab inferred={inferredData?.inferredProfile || null} />,
            },
            {
              key: 'subscription',
              label: (
                <span>
                  <CrownOutlined /> 订阅信息
                </span>
              ),
              children: <SubscriptionTab userId={id!} />,
            },
            {
              key: 'foodRecords',
              label: (
                <span>
                  <CoffeeOutlined /> 饮食记录
                </span>
              ),
              children: <FoodRecordsTab userId={id!} />,
            },
            {
              key: 'feedback',
              label: (
                <span>
                  <LikeOutlined /> 推荐反馈
                </span>
              ),
              children: <RecommendFeedbackTab userId={id!} />,
            },
            {
              key: 'strategy',
              label: (
                <span>
                  <ThunderboltOutlined /> 策略
                </span>
              ),
              children: <StrategyTab userId={id!} />,
            },
            {
              key: 'changeLogs',
              label: (
                <span>
                  <HistoryOutlined /> 画像变更日志
                </span>
              ),
              children: <ChangeLogsTab logs={allChangeLogs} />,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default UserDetailPage;

export const routeConfig = {
  name: 'user-detail',
  title: '用户画像详情',
  icon: 'UserOutlined',
  order: 6,
  requireAuth: true,
  hideInMenu: true,
};
