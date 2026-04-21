import React, { useState, useMemo } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Space,
  Button,
  Tabs,
  Table,
  message,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Slider,
  DatePicker,
  Popconfirm,
  Spin,
  Empty,
  Row,
  Col,
  Statistic,
  Progress,
  Alert,
  Typography,
  Divider,
  Tooltip,
  Collapse,
} from 'antd';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  StopOutlined,
  EditOutlined,
  UserAddOutlined,
  DeleteOutlined,
  GlobalOutlined,
  AimOutlined,
  ExperimentOutlined,
  UserOutlined,
  TeamOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  RocketOutlined,
  CoffeeOutlined,
  TrophyOutlined,
  BulbOutlined,
  SafetyOutlined,
  EyeOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useStrategyDetail,
  useUpdateStrategy,
  useActivateStrategy,
  useArchiveStrategy,
  useAssignStrategy,
  useRemoveAssignment,
  strategyApi,
  type StrategyScope,
  type StrategyStatus,
  type StrategyAssignmentDto,
  type AssignmentType,
  type StrategyConfig,
  type RankPolicyConfig,
  type RecallPolicyConfig,
  type BoostPolicyConfig,
  type ExplorationPolicyConfig,
  type MealPolicyConfig,
  type MultiObjectiveConfig,
  type AssemblyPolicyConfig,
  type ExplainPolicyConfig,
  type RealismConfig,
  type GoalType,
  SCORE_DIMENSION_NAMES,
} from '@/services/strategyManagementService';
import type { ColumnsType } from 'antd/es/table';

export const routeConfig = {
  name: 'strategy-detail',
  title: '策略详情',
  hideInMenu: true,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const scopeConfig: Record<StrategyScope, { color: string; icon: React.ReactNode; text: string }> = {
  global: { color: 'blue', icon: <GlobalOutlined />, text: '全局' },
  goal_type: { color: 'green', icon: <AimOutlined />, text: '目标类型' },
  experiment: { color: 'purple', icon: <ExperimentOutlined />, text: '实验' },
  user: { color: 'orange', icon: <UserOutlined />, text: '用户' },
};

const statusConfig: Record<StrategyStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  active: { color: 'success', text: '激活' },
  archived: { color: 'warning', text: '已归档' },
};

const assignmentTypeConfig: Record<AssignmentType, { color: string; text: string }> = {
  manual: { color: 'blue', text: '手动分配' },
  experiment: { color: 'purple', text: '实验分配' },
  segment: { color: 'cyan', text: '段落分配' },
};

const GOAL_TYPES: GoalType[] = ['fat_loss', 'muscle_gain', 'health', 'habit'];
const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '健康',
  habit: '养成习惯',
};

const DIMENSION_LABELS: Record<string, string> = {
  calories: '热量',
  protein: '蛋白质',
  carbs: '碳水',
  fat: '脂肪',
  quality: '质量',
  satiety: '饱腹感',
  glycemic: '升糖',
  nutrientDensity: '营养密度',
  inflammation: '抗炎',
  fiber: '膳食纤维',
  seasonality: '时令性',
  executability: '可执行性',
  popularity: '流行度',
  acquisition: '易获取',
};

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

// ==================== 辅助组件 ====================

const FieldLabel: React.FC<{ label: string; tooltip?: string }> = ({ label, tooltip }) => (
  <Space size={4}>
    <span>{label}</span>
    {tooltip && (
      <Tooltip title={tooltip}>
        <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
      </Tooltip>
    )}
  </Space>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({
  icon,
  title,
  subtitle,
}) => (
  <div style={{ marginBottom: 16 }}>
    <Space>
      {icon}
      <Typography.Title level={5} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
    </Space>
    {subtitle && (
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
        {subtitle}
      </Typography.Text>
    )}
  </div>
);

/** 只读展示一个配置值 */
const ConfigValue: React.FC<{ value: unknown; fallback?: string }> = ({
  value,
  fallback = '未设置 (使用默认值)',
}) => {
  if (value === undefined || value === null) {
    return <Typography.Text type="secondary">{fallback}</Typography.Text>;
  }
  if (typeof value === 'boolean') {
    return value ? <Tag color="success">是</Tag> : <Tag color="default">否</Tag>;
  }
  if (typeof value === 'number') {
    return <Typography.Text strong>{value}</Typography.Text>;
  }
  if (typeof value === 'string') {
    return <Tag>{value}</Tag>;
  }
  if (Array.isArray(value)) {
    return (
      <Typography.Text code style={{ fontSize: 12 }}>
        [{value.join(', ')}]
      </Typography.Text>
    );
  }
  return (
    <pre style={{ margin: 0, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
};

// ==================== 策略配置展示组件 ====================

const RankConfigView: React.FC<{ config?: RankPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置排序策略" />;
  return (
    <div>
      {config.baseWeights && (
        <>
          <Typography.Text strong>基础权重覆盖</Typography.Text>
          <Table
            size="small"
            pagination={false}
            style={{ marginTop: 8, marginBottom: 16 }}
            dataSource={SCORE_DIMENSION_NAMES.map((dim, i) => ({
              key: dim,
              dimension: DIMENSION_LABELS[dim] || dim,
              ...Object.fromEntries(
                GOAL_TYPES.map((g) => [g, config.baseWeights?.[g]?.[i] ?? '-'])
              ),
            }))}
            columns={[
              { title: '维度', dataIndex: 'dimension', width: 100 },
              ...GOAL_TYPES.map((g) => ({
                title: GOAL_TYPE_LABELS[g],
                dataIndex: g,
                width: 80,
                render: (v: number | string) =>
                  v === '-' ? (
                    <Typography.Text type="secondary">-</Typography.Text>
                  ) : (
                    <Typography.Text>{v}</Typography.Text>
                  ),
              })),
            ]}
          />
        </>
      )}
      {config.mealModifiers && (
        <>
          <Typography.Text strong>餐次权重修正</Typography.Text>
          <ConfigValue value={config.mealModifiers} />
        </>
      )}
      {config.statusModifiers && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text strong>用户状态权重修正</Typography.Text>
          <ConfigValue value={config.statusModifiers} />
        </div>
      )}
      {!config.baseWeights && !config.mealModifiers && !config.statusModifiers && (
        <Empty description="排序策略未设置任何参数" />
      )}
    </div>
  );
};

const RecallConfigView: React.FC<{ config?: RecallPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置召回策略" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="规则召回">
        <ConfigValue value={config.sources?.rule?.enabled} fallback="默认" />
      </Descriptions.Item>
      <Descriptions.Item label="向量召回">
        <Space>
          <ConfigValue value={config.sources?.vector?.enabled} fallback="默认" />
          {config.sources?.vector?.weight !== undefined && (
            <Tag>权重: {config.sources.vector.weight}</Tag>
          )}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="协同过滤召回">
        <Space>
          <ConfigValue value={config.sources?.cf?.enabled} fallback="默认" />
          {config.sources?.cf?.weight !== undefined && <Tag>权重: {config.sources.cf.weight}</Tag>}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="热门召回">
        <Space>
          <ConfigValue value={config.sources?.popular?.enabled} fallback="默认" />
          {config.sources?.popular?.weight !== undefined && (
            <Tag>权重: {config.sources.popular.weight}</Tag>
          )}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="短期拒绝阈值" span={2}>
        <ConfigValue value={config.shortTermRejectThreshold} fallback="默认 (2)" />
      </Descriptions.Item>
    </Descriptions>
  );
};

const BoostConfigView: React.FC<{ config?: BoostPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置加成策略" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="喜爱食物加成">
        <ConfigValue value={config.preference?.lovesMultiplier} fallback="默认 (1.12)" />
      </Descriptions.Item>
      <Descriptions.Item label="回避食物惩罚">
        <ConfigValue value={config.preference?.avoidsMultiplier} fallback="默认 (0.3)" />
      </Descriptions.Item>
      <Descriptions.Item label="CF 加成上限">
        <ConfigValue value={config.cfBoostCap} fallback="默认 (0.15)" />
      </Descriptions.Item>
      <Descriptions.Item label="相似度惩罚系数">
        <ConfigValue value={config.similarityPenaltyCoeff} fallback="默认 (0.3)" />
      </Descriptions.Item>
      <Descriptions.Item label="短期反馈增幅范围">
        <ConfigValue value={config.shortTerm?.boostRange} fallback="默认 [0.9, 1.1]" />
      </Descriptions.Item>
      <Descriptions.Item label="单次拒绝惩罚">
        <ConfigValue value={config.shortTerm?.singleRejectPenalty} fallback="默认 (0.85)" />
      </Descriptions.Item>
    </Descriptions>
  );
};

const ExplorationConfigView: React.FC<{ config?: ExplorationPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置探索策略" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="基础最小值">
        <ConfigValue value={config.baseMin} fallback="默认 (0.3)" />
      </Descriptions.Item>
      <Descriptions.Item label="基础最大值">
        <ConfigValue value={config.baseMax} fallback="默认 (1.7)" />
      </Descriptions.Item>
      <Descriptions.Item label="成熟度收缩">
        <ConfigValue value={config.maturityShrink} fallback="默认 (0.4)" />
      </Descriptions.Item>
      <Descriptions.Item label="成熟度阈值">
        <ConfigValue value={config.matureThreshold} fallback="默认 (50)" />
      </Descriptions.Item>
    </Descriptions>
  );
};

const MealConfigView: React.FC<{ config?: MealPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置餐次策略" />;
  return (
    <div>
      {config.mealRoles && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>餐次角色模板</Typography.Text>
          <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }}>
            {Object.entries(config.mealRoles).map(([meal, roles]) => (
              <Descriptions.Item label={MEAL_TYPE_LABELS[meal] || meal} key={meal}>
                {(roles as string[]).map((r) => (
                  <Tag key={r}>{r}</Tag>
                ))}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </div>
      )}
      {config.roleCategories && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>角色→分类映射</Typography.Text>
          <ConfigValue value={config.roleCategories} />
        </div>
      )}
      {config.mealRatios && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>餐次热量分配</Typography.Text>
          <ConfigValue value={config.mealRatios} />
        </div>
      )}
      {config.macroRanges && (
        <div>
          <Typography.Text strong>宏量营养素范围</Typography.Text>
          <ConfigValue value={config.macroRanges} />
        </div>
      )}
    </div>
  );
};

const MultiObjectiveConfigView: React.FC<{ config?: MultiObjectiveConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置多目标优化" />;
  return (
    <div>
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="启用">
          <ConfigValue value={config.enabled} fallback="默认 (关闭)" />
        </Descriptions.Item>
        <Descriptions.Item label="Pareto 前沿限制">
          <ConfigValue value={config.paretoFrontLimit} fallback="默认 (20)" />
        </Descriptions.Item>
        <Descriptions.Item label="成本敏感度">
          <ConfigValue value={config.costSensitivity} fallback="默认 (0.5)" />
        </Descriptions.Item>
      </Descriptions>
      {config.preferences && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>维度偏好权重</Typography.Text>
          <Row gutter={16} style={{ marginTop: 8 }}>
            {(['health', 'taste', 'cost', 'convenience'] as const).map((dim) => (
              <Col span={6} key={dim}>
                <Statistic
                  title={{ health: '健康', taste: '口味', cost: '成本', convenience: '便捷' }[dim]}
                  value={config.preferences?.[dim] ?? '-'}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
            ))}
          </Row>
        </div>
      )}
      {config.tastePreference && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>口味偏好向量</Typography.Text>
          <Row gutter={16} style={{ marginTop: 8 }}>
            {(['spicy', 'sweet', 'salty', 'sour', 'umami', 'bitter'] as const).map((t) => (
              <Col span={4} key={t}>
                <Statistic
                  title={
                    {
                      spicy: '辣',
                      sweet: '甜',
                      salty: '咸',
                      sour: '酸',
                      umami: '鲜',
                      bitter: '苦',
                    }[t]
                  }
                  value={config.tastePreference?.[t] ?? '-'}
                  valueStyle={{ fontSize: 14 }}
                />
              </Col>
            ))}
          </Row>
        </div>
      )}
    </div>
  );
};

const AssemblyConfigView: React.FC<{ config?: AssemblyPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置组装策略" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="优先使用食谱">
        <ConfigValue value={config.preferRecipe} fallback="默认" />
      </Descriptions.Item>
      <Descriptions.Item label="多样性等级">
        <ConfigValue
          value={
            config.diversityLevel
              ? { low: '低 (严格营养匹配)', medium: '中 (平衡)', high: '高 (最大化多样性)' }[
                  config.diversityLevel
                ]
              : undefined
          }
          fallback="默认"
        />
      </Descriptions.Item>
    </Descriptions>
  );
};

const ExplainConfigView: React.FC<{ config?: ExplainPolicyConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置解释策略" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="解释详细程度">
        <ConfigValue
          value={
            config.detailLevel
              ? {
                  simple: '简单 (一句话)',
                  standard: '标准 (营养概览+理由)',
                  detailed: '详细 (完整营养数据+维度评分+健康修正)',
                }[config.detailLevel]
              : undefined
          }
          fallback="默认"
        />
      </Descriptions.Item>
      <Descriptions.Item label="显示营养雷达图">
        <ConfigValue value={config.showNutritionRadar} fallback="默认" />
      </Descriptions.Item>
    </Descriptions>
  );
};

const RealismConfigView: React.FC<{ config?: RealismConfig }> = ({ config }) => {
  if (!config) return <Empty description="未配置现实性过滤" />;
  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="启用">
        <ConfigValue value={config.enabled} fallback="默认 (开启)" />
      </Descriptions.Item>
      <Descriptions.Item label="常见度阈值">
        <ConfigValue value={config.commonalityThreshold} fallback="默认 (20)" />
      </Descriptions.Item>
      <Descriptions.Item label="预算过滤">
        <ConfigValue value={config.budgetFilterEnabled} fallback="默认 (关闭)" />
      </Descriptions.Item>
      <Descriptions.Item label="烹饪时间过滤">
        <ConfigValue value={config.cookTimeCapEnabled} fallback="默认 (关闭)" />
      </Descriptions.Item>
      <Descriptions.Item label="工作日烹饪上限">
        <ConfigValue
          value={config.weekdayCookTimeCap ? `${config.weekdayCookTimeCap} 分钟` : undefined}
          fallback="默认 (45分钟)"
        />
      </Descriptions.Item>
      <Descriptions.Item label="周末烹饪上限">
        <ConfigValue
          value={config.weekendCookTimeCap ? `${config.weekendCookTimeCap} 分钟` : undefined}
          fallback="默认 (120分钟)"
        />
      </Descriptions.Item>
      <Descriptions.Item label="可执行性权重倍数">
        <ConfigValue value={config.executabilityWeightMultiplier} fallback="默认 (1.0)" />
      </Descriptions.Item>
      <Descriptions.Item label="食堂模式">
        <ConfigValue value={config.canteenMode} fallback="默认 (关闭)" />
      </Descriptions.Item>
    </Descriptions>
  );
};

// ==================== 编辑表单组件 ====================

const RankEditForm: React.FC<{ form: any; prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<SettingOutlined />}
      title="排序权重"
      subtitle="覆盖各目标类型的14维评分权重，未填写则使用系统默认值"
    />
    <Alert
      message="每个目标类型对应14个维度的权重数组，顺序为: 热量、蛋白质、碳水、脂肪、质量、饱腹感、升糖、营养密度、抗炎、膳食纤维、时令性、可执行性、流行度、易获取"
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
    />
    <Collapse
      items={GOAL_TYPES.map((goal) => ({
        key: goal,
        label: `${GOAL_TYPE_LABELS[goal]} (${goal})`,
        children: (
          <Row gutter={[12, 8]}>
            {SCORE_DIMENSION_NAMES.map((dim, i) => (
              <Col span={6} key={dim}>
                <Form.Item
                  name={[...prefix, 'baseWeights', goal, i]}
                  label={<FieldLabel label={DIMENSION_LABELS[dim]} tooltip={dim} />}
                  style={{ marginBottom: 8 }}
                >
                  <InputNumber step={0.01} style={{ width: '100%' }} placeholder="默认" />
                </Form.Item>
              </Col>
            ))}
          </Row>
        ),
      }))}
    />
  </div>
);

const RecallEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<SearchOutlined />}
      title="召回源配置"
      subtitle="控制候选食物的来源通道及其权重"
    />
    <Row gutter={[16, 12]}>
      {(
        [
          { key: 'rule', label: '规则召回', hasWeight: false },
          { key: 'vector', label: '向量召回', hasWeight: true },
          { key: 'cf', label: '协同过滤', hasWeight: true },
          { key: 'popular', label: '热门召回', hasWeight: true },
        ] as const
      ).map((source) => (
        <Col span={12} key={source.key}>
          <Card size="small" title={source.label}>
            <Form.Item
              name={[...prefix, 'sources', source.key, 'enabled']}
              label="启用"
              valuePropName="checked"
              style={{ marginBottom: source.hasWeight ? 8 : 0 }}
            >
              <Switch />
            </Form.Item>
            {source.hasWeight && (
              <Form.Item
                name={[...prefix, 'sources', source.key, 'weight']}
                label="权重"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  min={0}
                  max={1}
                  step={0.05}
                  style={{ width: '100%' }}
                  placeholder="默认"
                />
              </Form.Item>
            )}
          </Card>
        </Col>
      ))}
    </Row>
    <Divider />
    <Form.Item
      name={[...prefix, 'shortTermRejectThreshold']}
      label={
        <FieldLabel label="短期拒绝阈值" tooltip="用户近期拒绝次数达到此值后过滤该食物，默认 2" />
      }
    >
      <InputNumber min={1} max={10} style={{ width: 200 }} placeholder="默认 2" />
    </Form.Item>
  </div>
);

const BoostEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<ThunderboltOutlined />}
      title="加成/惩罚系数"
      subtitle="控制偏好、协同过滤、短期行为等因子的加成幅度"
    />
    <Row gutter={16}>
      <Col span={12}>
        <Card size="small" title="偏好加成">
          <Form.Item
            name={[...prefix, 'preference', 'lovesMultiplier']}
            label={<FieldLabel label="喜爱加成倍数" tooltip="喜爱食物的评分乘数，默认 1.12" />}
            style={{ marginBottom: 8 }}
          >
            <InputNumber
              min={1}
              max={2}
              step={0.01}
              style={{ width: '100%' }}
              placeholder="默认 1.12"
            />
          </Form.Item>
          <Form.Item
            name={[...prefix, 'preference', 'avoidsMultiplier']}
            label={<FieldLabel label="回避惩罚倍数" tooltip="回避食物的评分乘数，默认 0.3" />}
            style={{ marginBottom: 0 }}
          >
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              style={{ width: '100%' }}
              placeholder="默认 0.3"
            />
          </Form.Item>
        </Card>
      </Col>
      <Col span={12}>
        <Card size="small" title="短期行为">
          <Form.Item
            name={[...prefix, 'shortTerm', 'boostRange', 0]}
            label={<FieldLabel label="增幅下限" tooltip="短期接受率增幅范围下限，默认 0.9" />}
            style={{ marginBottom: 8 }}
          >
            <InputNumber
              min={0.5}
              max={1}
              step={0.05}
              style={{ width: '100%' }}
              placeholder="默认 0.9"
            />
          </Form.Item>
          <Form.Item
            name={[...prefix, 'shortTerm', 'boostRange', 1]}
            label={<FieldLabel label="增幅上限" tooltip="短期接受率增幅范围上限，默认 1.1" />}
            style={{ marginBottom: 8 }}
          >
            <InputNumber
              min={1}
              max={1.5}
              step={0.05}
              style={{ width: '100%' }}
              placeholder="默认 1.1"
            />
          </Form.Item>
          <Form.Item
            name={[...prefix, 'shortTerm', 'singleRejectPenalty']}
            label={<FieldLabel label="单次拒绝惩罚" tooltip="单次拒绝后评分乘数，默认 0.85" />}
            style={{ marginBottom: 0 }}
          >
            <InputNumber
              min={0.5}
              max={1}
              step={0.05}
              style={{ width: '100%' }}
              placeholder="默认 0.85"
            />
          </Form.Item>
        </Card>
      </Col>
    </Row>
    <Row gutter={16} style={{ marginTop: 12 }}>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'cfBoostCap']}
          label={
            <FieldLabel label="协同过滤加成上限" tooltip="CF 推荐评分加成的上限值，默认 0.15" />
          }
        >
          <InputNumber
            min={0}
            max={0.5}
            step={0.01}
            style={{ width: '100%' }}
            placeholder="默认 0.15"
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'similarityPenaltyCoeff']}
          label={
            <FieldLabel label="相似度惩罚系数" tooltip="候选池内相似食物的评分衰减系数，默认 0.3" />
          }
        >
          <InputNumber
            min={0}
            max={1}
            step={0.05}
            style={{ width: '100%' }}
            placeholder="默认 0.3"
          />
        </Form.Item>
      </Col>
    </Row>
  </div>
);

const ExplorationEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<RocketOutlined />}
      title="探索策略 (Thompson Sampling)"
      subtitle="控制新用户/成熟用户的探索-利用平衡。公式: 范围 = [baseMin + shrink × maturity, baseMax - shrink × maturity]"
    />
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'baseMin']}
          label={<FieldLabel label="基础最小值" tooltip="新用户探索系数下界，默认 0.3" />}
        >
          <InputNumber
            min={0}
            max={1}
            step={0.1}
            style={{ width: '100%' }}
            placeholder="默认 0.3"
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'baseMax']}
          label={<FieldLabel label="基础最大值" tooltip="新用户探索系数上界，默认 1.7" />}
        >
          <InputNumber
            min={1}
            max={3}
            step={0.1}
            style={{ width: '100%' }}
            placeholder="默认 1.7"
          />
        </Form.Item>
      </Col>
    </Row>
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'maturityShrink']}
          label={<FieldLabel label="成熟收缩量" tooltip="成熟用户的探索范围收缩值，默认 0.4" />}
        >
          <InputNumber
            min={0}
            max={1}
            step={0.05}
            style={{ width: '100%' }}
            placeholder="默认 0.4"
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'matureThreshold']}
          label={
            <FieldLabel label="成熟阈值 (交互次数)" tooltip="达到此交互次数视为完全成熟，默认 50" />
          }
        >
          <InputNumber
            min={10}
            max={200}
            step={10}
            style={{ width: '100%' }}
            placeholder="默认 50"
          />
        </Form.Item>
      </Col>
    </Row>
  </div>
);

const MealEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<CoffeeOutlined />}
      title="餐次组合策略"
      subtitle="控制各餐次的角色模板、分类映射和热量分配"
    />
    <Alert
      message="餐次角色模板和分类映射为复杂嵌套结构，建议通过「原始 JSON」选项卡手动编辑这些字段"
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
    />
    <Typography.Text strong>餐次热量分配比例 (mealRatios)</Typography.Text>
    <div style={{ marginTop: 8 }}>
      {GOAL_TYPES.map((goal) => (
        <Card size="small" title={GOAL_TYPE_LABELS[goal]} key={goal} style={{ marginBottom: 8 }}>
          <Row gutter={12}>
            {MEAL_TYPES.map((meal) => (
              <Col span={6} key={meal}>
                <Form.Item
                  name={[...prefix, 'mealRatios', goal, meal]}
                  label={MEAL_TYPE_LABELS[meal]}
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.05}
                    style={{ width: '100%' }}
                    placeholder="0~1"
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Card>
      ))}
    </div>
  </div>
);

const MultiObjectiveEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<TrophyOutlined />}
      title="多目标优化"
      subtitle="Pareto 前沿多维度权衡：健康、口味、成本、便捷"
    />
    <Row gutter={16}>
      <Col span={8}>
        <Form.Item name={[...prefix, 'enabled']} label="启用多目标优化" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'paretoFrontLimit']}
          label={<FieldLabel label="Pareto 前沿上限" tooltip="保留在前沿的最大食物数，默认 20" />}
        >
          <InputNumber min={5} max={100} style={{ width: '100%' }} placeholder="默认 20" />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'costSensitivity']}
          label={<FieldLabel label="成本敏感度" tooltip="0=无感 1=极度敏感，默认 0.5" />}
        >
          <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.5: '0.5', 1: '1' }} />
        </Form.Item>
      </Col>
    </Row>
    <Divider orientation="left">维度偏好权重</Divider>
    <Row gutter={16}>
      {(
        [
          { key: 'health', label: '健康' },
          { key: 'taste', label: '口味' },
          { key: 'cost', label: '成本' },
          { key: 'convenience', label: '便捷' },
        ] as const
      ).map((dim) => (
        <Col span={6} key={dim.key}>
          <Form.Item name={[...prefix, 'preferences', dim.key]} label={dim.label}>
            <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} placeholder="0~1" />
          </Form.Item>
        </Col>
      ))}
    </Row>
    <Divider orientation="left">口味偏好向量</Divider>
    <Row gutter={16}>
      {(
        [
          { key: 'spicy', label: '辣' },
          { key: 'sweet', label: '甜' },
          { key: 'salty', label: '咸' },
          { key: 'sour', label: '酸' },
          { key: 'umami', label: '鲜' },
          { key: 'bitter', label: '苦' },
        ] as const
      ).map((t) => (
        <Col span={4} key={t.key}>
          <Form.Item name={[...prefix, 'tastePreference', t.key]} label={t.label}>
            <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} placeholder="0~1" />
          </Form.Item>
        </Col>
      ))}
    </Row>
  </div>
);

const AssemblyEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<BulbOutlined />}
      title="组装策略"
      subtitle="控制食谱优先级和推荐多样性等级"
    />
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'preferRecipe']}
          label={<FieldLabel label="优先使用食谱" tooltip="开启后将优先从食谱库推荐组合" />}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'diversityLevel']}
          label={
            <FieldLabel label="多样性等级" tooltip="低=严格营养匹配 中=平衡 高=最大化多样性" />
          }
        >
          <Select
            allowClear
            placeholder="默认"
            options={[
              { label: '低 - 严格营养匹配', value: 'low' },
              { label: '中 - 平衡', value: 'medium' },
              { label: '高 - 最大化多样性', value: 'high' },
            ]}
          />
        </Form.Item>
      </Col>
    </Row>
  </div>
);

const ExplainEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<EyeOutlined />}
      title="解释策略"
      subtitle="控制推荐结果中的解释详细程度和营养雷达图"
    />
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'detailLevel']}
          label={
            <FieldLabel
              label="解释详细程度"
              tooltip="simple=一句话 standard=营养概览+理由 detailed=完整数据"
            />
          }
        >
          <Select
            allowClear
            placeholder="默认"
            options={[
              { label: '简单 - 一句话', value: 'simple' },
              { label: '标准 - 营养概览+理由', value: 'standard' },
              { label: '详细 - 完整数据+评分+修正', value: 'detailed' },
            ]}
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name={[...prefix, 'showNutritionRadar']}
          label={<FieldLabel label="显示营养雷达图" tooltip="是否在推荐结果中返回雷达图数据" />}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Col>
    </Row>
  </div>
);

const RealismEditForm: React.FC<{ prefix: string[] }> = ({ prefix }) => (
  <div>
    <SectionTitle
      icon={<SafetyOutlined />}
      title="现实性过滤"
      subtitle="控制食物推荐的可执行性约束：常见度、预算、烹饪时间等"
    />
    <Row gutter={16}>
      <Col span={8}>
        <Form.Item name={[...prefix, 'enabled']} label="启用现实性过滤" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'canteenMode']}
          label={<FieldLabel label="食堂模式" tooltip="V6.6: 跳过烹饪时间，提升常见度阈值至60" />}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'budgetFilterEnabled']}
          label="启用预算过滤"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Col>
    </Row>
    <Divider />
    <Row gutter={16}>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'commonalityThreshold']}
          label={<FieldLabel label="常见度阈值" tooltip="0-100，低于此值的食物被过滤，默认 20" />}
        >
          <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="默认 20" />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'executabilityWeightMultiplier']}
          label={<FieldLabel label="可执行性权重倍数" tooltip="默认 1.0，2.0=双倍权重" />}
        >
          <InputNumber
            min={0.1}
            max={5}
            step={0.1}
            style={{ width: '100%' }}
            placeholder="默认 1.0"
          />
        </Form.Item>
      </Col>
    </Row>
    <Divider orientation="left">烹饪时间限制</Divider>
    <Row gutter={16}>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'cookTimeCapEnabled']}
          label="启用烹饪时间限制"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'weekdayCookTimeCap']}
          label={<FieldLabel label="工作日上限 (分钟)" tooltip="默认 45 分钟" />}
        >
          <InputNumber min={5} max={180} style={{ width: '100%' }} placeholder="默认 45" />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item
          name={[...prefix, 'weekendCookTimeCap']}
          label={<FieldLabel label="周末上限 (分钟)" tooltip="默认 120 分钟" />}
        >
          <InputNumber min={5} max={360} style={{ width: '100%' }} placeholder="默认 120" />
        </Form.Item>
      </Col>
    </Row>
  </div>
);

// ==================== 将策略配置扁平化到表单值 ====================

function configToFormValues(config: StrategyConfig): Record<string, unknown> {
  const values: Record<string, any> = {};
  if (!config) return values;

  // 直接设置每个维度——Form 的嵌套 name path 会处理
  const dimensions = [
    'rank',
    'recall',
    'boost',
    'exploration',
    'meal',
    'multiObjective',
    'assembly',
    'explain',
    'realism',
  ] as const;

  for (const dim of dimensions) {
    if (config[dim]) {
      values[dim] = JSON.parse(JSON.stringify(config[dim]));
    }
  }

  // 特殊处理 rank.baseWeights: Record<GoalType, number[]> → 需要展平为 { [goal]: { [index]: number } }
  if (config.rank?.baseWeights) {
    if (!values.rank) values.rank = {};
    values.rank.baseWeights = {};
    for (const [goal, weights] of Object.entries(config.rank.baseWeights)) {
      if (Array.isArray(weights)) {
        values.rank.baseWeights[goal] = Object.fromEntries(weights.map((w, i) => [i, w]));
      }
    }
  }

  return values;
}

/** 从表单值提取策略配置，清理掉 undefined 值 */
function formValuesToConfig(values: Record<string, any>): StrategyConfig {
  const config: StrategyConfig = {};

  // rank: 需要将 baseWeights 从 { [goal]: { [index]: number } } → { [goal]: number[] }
  if (values.rank) {
    const rank: RankPolicyConfig = {};
    if (values.rank.baseWeights) {
      rank.baseWeights = {} as any;
      for (const [goal, indexMap] of Object.entries(values.rank.baseWeights)) {
        if (indexMap && typeof indexMap === 'object') {
          const arr: number[] = [];
          let hasValues = false;
          for (let i = 0; i < 14; i++) {
            const v = (indexMap as any)[i];
            if (v !== undefined && v !== null) {
              arr[i] = v;
              hasValues = true;
            }
          }
          if (hasValues) {
            (rank.baseWeights as any)[goal] = arr;
          }
        }
      }
      if (Object.keys(rank.baseWeights!).length === 0) delete rank.baseWeights;
    }
    if (values.rank.mealModifiers) rank.mealModifiers = values.rank.mealModifiers;
    if (values.rank.statusModifiers) rank.statusModifiers = values.rank.statusModifiers;
    if (Object.keys(rank).length > 0) config.rank = rank;
  }

  // 简单维度：直接复制非空值
  const simpleDims = [
    'recall',
    'boost',
    'exploration',
    'meal',
    'multiObjective',
    'assembly',
    'explain',
    'realism',
  ] as const;

  for (const dim of simpleDims) {
    if (values[dim] && typeof values[dim] === 'object') {
      const cleaned = deepClean(values[dim]);
      if (cleaned && Object.keys(cleaned).length > 0) {
        (config as any)[dim] = cleaned;
      }
    }
  }

  return config;
}

/** 深度清除 undefined/null 值 */
function deepClean(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    const cleaned = obj.map(deepClean);
    return cleaned.some((v) => v !== undefined) ? cleaned : undefined;
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = deepClean(v);
    if (cleaned !== undefined) {
      result[k] = cleaned;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ==================== 策略配置 Tab 定义 ====================

const CONFIG_TABS = [
  {
    key: 'rank',
    label: '排序权重',
    icon: <SettingOutlined />,
    configKey: 'rank' as const,
    ViewComponent: RankConfigView,
    EditComponent: RankEditForm,
  },
  {
    key: 'recall',
    label: '召回源',
    icon: <SearchOutlined />,
    configKey: 'recall' as const,
    ViewComponent: RecallConfigView,
    EditComponent: RecallEditForm,
  },
  {
    key: 'boost',
    label: '加成/惩罚',
    icon: <ThunderboltOutlined />,
    configKey: 'boost' as const,
    ViewComponent: BoostConfigView,
    EditComponent: BoostEditForm,
  },
  {
    key: 'exploration',
    label: '探索策略',
    icon: <RocketOutlined />,
    configKey: 'exploration' as const,
    ViewComponent: ExplorationConfigView,
    EditComponent: ExplorationEditForm,
  },
  {
    key: 'meal',
    label: '餐次组合',
    icon: <CoffeeOutlined />,
    configKey: 'meal' as const,
    ViewComponent: MealConfigView,
    EditComponent: MealEditForm,
  },
  {
    key: 'multiObjective',
    label: '多目标优化',
    icon: <TrophyOutlined />,
    configKey: 'multiObjective' as const,
    ViewComponent: MultiObjectiveConfigView,
    EditComponent: MultiObjectiveEditForm,
  },
  {
    key: 'assembly',
    label: '组装',
    icon: <BulbOutlined />,
    configKey: 'assembly' as const,
    ViewComponent: AssemblyConfigView,
    EditComponent: AssemblyEditForm,
  },
  {
    key: 'explain',
    label: '解释',
    icon: <EyeOutlined />,
    configKey: 'explain' as const,
    ViewComponent: ExplainConfigView,
    EditComponent: ExplainEditForm,
  },
  {
    key: 'realism',
    label: '现实性',
    icon: <SafetyOutlined />,
    configKey: 'realism' as const,
    ViewComponent: RealismConfigView,
    EditComponent: RealismEditForm,
  },
];

// ==================== 主组件 ====================

const StrategyDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: strategy, isLoading } = useStrategyDetail(id!, !!id);

  // 编辑弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();

  // 分配弹窗
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignForm] = Form.useForm();

  // 批量分配弹窗
  const [batchAssignVisible, setBatchAssignVisible] = useState(false);
  const [batchAssignForm] = Form.useForm();
  const [batchProgress, setBatchProgress] = useState<{
    running: boolean;
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ userId: string; error: string }>;
  }>({ running: false, total: 0, completed: 0, succeeded: 0, failed: 0, errors: [] });

  // 分配列表
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignments, setAssignments] = useState<StrategyAssignmentDto[]>([]);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignmentLoading, setAssignmentLoading] = useState(false);

  const updateMutation = useUpdateStrategy({
    onSuccess: () => {
      message.success('策略更新成功');
      setEditModalVisible(false);
    },
    onError: (error: any) => message.error(`更新失败: ${error.message}`),
  });

  const activateMutation = useActivateStrategy({
    onSuccess: () => message.success('策略已激活'),
    onError: (error: any) => message.error(`激活失败: ${error.message}`),
  });

  const archiveMutation = useArchiveStrategy({
    onSuccess: () => message.success('策略已归档'),
    onError: (error: any) => message.error(`归档失败: ${error.message}`),
  });

  const assignMutation = useAssignStrategy({
    onSuccess: () => {
      message.success('分配成功');
      setAssignModalVisible(false);
      assignForm.resetFields();
      loadAssignments();
    },
    onError: (error: any) => message.error(`分配失败: ${error.message}`),
  });

  const removeMutation = useRemoveAssignment({
    onSuccess: () => {
      message.success('已取消分配');
      loadAssignments();
    },
    onError: (error: any) => message.error(`取消分配失败: ${error.message}`),
  });

  // 统计已配置的维度数
  const configuredDimCount = useMemo(() => {
    if (!strategy?.config) return 0;
    return CONFIG_TABS.filter((tab) => (strategy.config as any)[tab.configKey] != null).length;
  }, [strategy?.config]);

  // ==================== 加载分配列表 ====================

  const loadAssignments = async (page = 1) => {
    if (!id) return;
    setAssignmentLoading(true);
    try {
      const res = await strategyApi.getAssignments(id, { page, pageSize: 20 });
      setAssignments(res.list);
      setAssignmentTotal(res.total);
      setAssignmentPage(page);
    } catch {
      message.error('加载分配列表失败');
    } finally {
      setAssignmentLoading(false);
    }
  };

  // ==================== 编辑提交 ====================

  const handleEdit = () => {
    if (!strategy) return;
    const formValues = configToFormValues(strategy.config || {});
    editForm.setFieldsValue({
      name: strategy.name,
      description: strategy.description || '',
      priority: strategy.priority,
      ...formValues,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    if (!id) return;
    try {
      const values = await editForm.validateFields();
      const config = formValuesToConfig(values);
      updateMutation.mutate({
        id,
        data: {
          name: values.name,
          description: values.description || undefined,
          priority: values.priority,
          config: Object.keys(config).length > 0 ? config : undefined,
        },
      });
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('表单校验失败');
    }
  };

  // ==================== 批量分配 ====================

  const handleBatchAssign = async () => {
    if (!id) return;
    try {
      const values = await batchAssignForm.validateFields();
      const raw: string = values.userIds || '';
      const userIds = raw
        .split(/[,\n\s]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      if (userIds.length === 0) {
        message.warning('请输入至少一个用户 ID');
        return;
      }

      const uniqueIds = [...new Set(userIds)];
      if (uniqueIds.length !== userIds.length) {
        message.info(`已自动去重：${userIds.length} → ${uniqueIds.length} 个用户`);
      }

      setBatchProgress({
        running: true,
        total: uniqueIds.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
      });

      const assignmentType = values.assignmentType || 'manual';
      const source = values.source || undefined;
      const activeFrom = values.activeRange?.[0]?.toISOString();
      const activeUntil = values.activeRange?.[1]?.toISOString();

      let succeeded = 0;
      let failed = 0;
      const errors: Array<{ userId: string; error: string }> = [];

      for (let i = 0; i < uniqueIds.length; i++) {
        try {
          await strategyApi.assignStrategy(id, {
            userId: uniqueIds[i],
            assignmentType,
            source,
            activeFrom,
            activeUntil,
          });
          succeeded++;
        } catch (err: any) {
          failed++;
          errors.push({
            userId: uniqueIds[i],
            error: err?.message || '未知错误',
          });
        }
        setBatchProgress((prev) => ({
          ...prev,
          completed: i + 1,
          succeeded,
          failed,
          errors: [...errors],
        }));
      }

      setBatchProgress((prev) => ({ ...prev, running: false }));

      if (failed === 0) {
        message.success(`批量分配完成：${succeeded} 个用户全部成功`);
        setBatchAssignVisible(false);
        batchAssignForm.resetFields();
        setBatchProgress({
          running: false,
          total: 0,
          completed: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
        });
        loadAssignments();
      } else {
        message.warning(`批量分配完成：${succeeded} 成功，${failed} 失败`);
        loadAssignments();
      }
    } catch {
      // 表单验证失败
    }
  };

  // ==================== 分配提交 ====================

  const handleAssign = async () => {
    if (!id) return;
    try {
      const values = await assignForm.validateFields();
      assignMutation.mutate({
        strategyId: id,
        data: {
          userId: values.userId,
          assignmentType: values.assignmentType,
          source: values.source || undefined,
          activeFrom: values.activeRange?.[0]?.toISOString(),
          activeUntil: values.activeRange?.[1]?.toISOString(),
        },
      });
    } catch {
      // 校验失败
    }
  };

  // ==================== 分配列表列 ====================

  const assignmentColumns: ColumnsType<StrategyAssignmentDto> = [
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 280,
      ellipsis: true,
    },
    {
      title: '分配类型',
      dataIndex: 'assignmentType',
      width: 120,
      render: (type: AssignmentType) => {
        const cfg = assignmentTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.text || type}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (val: string | null) => val || '-',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (active: boolean) => (active ? <Tag color="success">生效中</Tag> : <Tag>已停止</Tag>),
    },
    {
      title: '生效时间',
      key: 'period',
      width: 200,
      render: (_, record) => {
        const from = record.activeFrom
          ? new Date(record.activeFrom).toLocaleDateString()
          : '无限制';
        const until = record.activeUntil
          ? new Date(record.activeUntil).toLocaleDateString()
          : '无限制';
        return `${from} ~ ${until}`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) =>
        record.isActive ? (
          <Popconfirm
            title="确认取消此分配？"
            onConfirm={() =>
              removeMutation.mutate({
                strategyId: id!,
                assignmentId: record.id,
                userId: record.userId,
              })
            }
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              取消
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  if (isLoading || !strategy) {
    return (
      <Card>
        <Spin spinning={isLoading}>{!isLoading && <Empty description="策略不存在" />}</Spin>
      </Card>
    );
  }

  const scopeCfg = scopeConfig[strategy.scope];
  const statusCfg = statusConfig[strategy.status];

  return (
    <>
      {/* 头部 */}
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
            <span>{strategy.name}</span>
            <Tag color={statusCfg.color}>{statusCfg.text}</Tag>
            <Tag>v{strategy.version}</Tag>
          </Space>
        }
        extra={
          <Space>
            {strategy.status !== 'archived' && (
              <Button icon={<EditOutlined />} onClick={handleEdit}>
                编辑
              </Button>
            )}
            {strategy.status === 'draft' && (
              <Popconfirm
                title="激活将替换同范围的现有激活策略，确认？"
                onConfirm={() => activateMutation.mutate(id!)}
              >
                <Button type="primary" icon={<PlayCircleOutlined />}>
                  激活
                </Button>
              </Popconfirm>
            )}
            {strategy.status === 'active' && (
              <Popconfirm
                title="归档后策略将不再生效且不可修改，确认？"
                onConfirm={() => archiveMutation.mutate(id!)}
              >
                <Button danger icon={<StopOutlined />}>
                  归档
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Statistic title="活跃分配数" value={strategy.activeAssignmentCount || 0} />
          </Col>
          <Col span={6}>
            <Statistic title="版本" value={strategy.version} prefix="v" />
          </Col>
          <Col span={6}>
            <Statistic title="优先级" value={strategy.priority} />
          </Col>
          <Col span={6}>
            <Statistic
              title="已配置维度"
              value={configuredDimCount}
              suffix={`/ ${CONFIG_TABS.length}`}
            />
          </Col>
        </Row>

        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="策略ID">{strategy.id}</Descriptions.Item>
          <Descriptions.Item label="范围">
            <Tag color={scopeCfg.color} icon={scopeCfg.icon}>
              {scopeCfg.text}
            </Tag>
            {strategy.scopeTarget && <Tag>{strategy.scopeTarget}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(strategy.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(strategy.updatedAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {strategy.description || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Tab 页 */}
      <Card style={{ marginTop: 16 }}>
        <Tabs
          defaultActiveKey="config"
          onChange={(key) => {
            if (key === 'assignments') loadAssignments();
          }}
          items={[
            {
              key: 'config',
              label: '策略配置',
              children: (
                <div>
                  {/* 配置概览：哪些维度已设置 */}
                  <div style={{ marginBottom: 16 }}>
                    <Space wrap>
                      {CONFIG_TABS.map((tab) => {
                        const isSet = (strategy.config as any)?.[tab.configKey] != null;
                        return (
                          <Tag
                            key={tab.key}
                            color={isSet ? 'blue' : 'default'}
                            icon={isSet ? <CheckCircleOutlined /> : tab.icon}
                          >
                            {tab.label}
                            {isSet ? ' ✓' : ' (默认)'}
                          </Tag>
                        );
                      })}
                    </Space>
                  </div>

                  <Tabs
                    type="card"
                    items={CONFIG_TABS.map((tab) => ({
                      key: tab.key,
                      label: (
                        <Space size={4}>
                          {tab.icon}
                          <span>{tab.label}</span>
                          {(strategy.config as any)?.[tab.configKey] != null && (
                            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 10 }} />
                          )}
                        </Space>
                      ),
                      children: (
                        <tab.ViewComponent config={(strategy.config as any)?.[tab.configKey]} />
                      ),
                    }))}
                  />
                </div>
              ),
            },
            {
              key: 'assignments',
              label: '策略分配',
              children: (
                <>
                  <Space style={{ marginBottom: 16 }}>
                    {strategy.status === 'active' && (
                      <>
                        <Button
                          type="primary"
                          icon={<UserAddOutlined />}
                          onClick={() => setAssignModalVisible(true)}
                        >
                          分配给用户
                        </Button>
                        <Button
                          icon={<TeamOutlined />}
                          onClick={() => {
                            setBatchAssignVisible(true);
                            setBatchProgress({
                              running: false,
                              total: 0,
                              completed: 0,
                              succeeded: 0,
                              failed: 0,
                              errors: [],
                            });
                          }}
                        >
                          批量分配
                        </Button>
                      </>
                    )}
                    <Button onClick={() => loadAssignments(assignmentPage)}>刷新</Button>
                  </Space>
                  <Table<StrategyAssignmentDto>
                    rowKey="id"
                    columns={assignmentColumns}
                    dataSource={assignments}
                    loading={assignmentLoading}
                    pagination={{
                      current: assignmentPage,
                      total: assignmentTotal,
                      pageSize: 20,
                      onChange: (p) => loadAssignments(p),
                    }}
                    scroll={{ x: 1000 }}
                    size="small"
                  />
                </>
              ),
            },
            {
              key: 'raw',
              label: '原始 JSON',
              children: (
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 8,
                    maxHeight: 600,
                    overflow: 'auto',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  {JSON.stringify(strategy, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑弹窗 - 结构化表单 */}
      <Modal
        title="编辑策略"
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          editForm.resetFields();
        }}
        onOk={handleEditSubmit}
        confirmLoading={updateMutation.isPending}
        width={960}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Form form={editForm} layout="vertical" size="small">
          {/* 基本信息 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="策略名称"
                rules={[{ required: true, message: '请输入策略名称' }]}
              >
                <Input maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="priority" label="优先级">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Divider>策略配置（9大维度）</Divider>

          <Tabs
            type="card"
            size="small"
            items={CONFIG_TABS.map((tab) => ({
              key: tab.key,
              label: (
                <Space size={4}>
                  {tab.icon}
                  <span>{tab.label}</span>
                </Space>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  {tab.EditComponent ? (
                    <tab.EditComponent form={editForm} prefix={[tab.configKey]} />
                  ) : null}
                </div>
              ),
            }))}
          />
        </Form>
      </Modal>

      {/* 分配弹窗 */}
      <Modal
        title="分配策略给用户"
        open={assignModalVisible}
        onCancel={() => {
          setAssignModalVisible(false);
          assignForm.resetFields();
        }}
        onOk={handleAssign}
        confirmLoading={assignMutation.isPending}
        width={520}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="userId"
            label="用户 ID"
            rules={[{ required: true, message: '请输入用户ID' }]}
          >
            <Input placeholder="用户 UUID" />
          </Form.Item>
          <Form.Item
            name="assignmentType"
            label="分配类型"
            rules={[{ required: true, message: '请选择分配类型' }]}
          >
            <Select
              options={[
                { label: '手动分配', value: 'manual' },
                { label: '实验分配', value: 'experiment' },
                { label: '段落分配', value: 'segment' },
              ]}
            />
          </Form.Item>
          <Form.Item name="source" label="来源标识">
            <Input placeholder="实验ID / 段落名 / 操作人ID（可选）" />
          </Form.Item>
          <Form.Item name="activeRange" label="生效时间范围">
            <DatePicker.RangePicker
              showTime
              style={{ width: '100%' }}
              placeholder={['开始时间（可选）', '结束时间（可选）']}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量分配弹窗 */}
      <Modal
        title={
          <Space>
            <TeamOutlined />
            <span>批量分配策略</span>
          </Space>
        }
        open={batchAssignVisible}
        onCancel={() => {
          if (batchProgress.running) {
            message.warning('批量分配正在执行中，请等待完成');
            return;
          }
          setBatchAssignVisible(false);
          batchAssignForm.resetFields();
          setBatchProgress({
            running: false,
            total: 0,
            completed: 0,
            succeeded: 0,
            failed: 0,
            errors: [],
          });
        }}
        onOk={handleBatchAssign}
        confirmLoading={batchProgress.running}
        okText={batchProgress.running ? '分配中...' : '开始批量分配'}
        okButtonProps={{ disabled: batchProgress.running }}
        width={640}
        maskClosable={!batchProgress.running}
      >
        <Form form={batchAssignForm} layout="vertical">
          <Form.Item
            name="userIds"
            label={
              <Space>
                <span>用户 ID 列表</span>
                <Typography.Text type="secondary">（支持逗号、换行、空格分隔）</Typography.Text>
              </Space>
            }
            rules={[{ required: true, message: '请输入至少一个用户 ID' }]}
          >
            <Input.TextArea
              rows={6}
              placeholder={`粘贴用户 UUID，每行一个或用逗号分隔：\nuuid-001\nuuid-002\nuuid-003`}
              disabled={batchProgress.running}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="assignmentType"
                label="分配类型"
                initialValue="manual"
                rules={[{ required: true, message: '请选择分配类型' }]}
              >
                <Select
                  disabled={batchProgress.running}
                  options={[
                    { label: '手动分配', value: 'manual' },
                    { label: '实验分配', value: 'experiment' },
                    { label: '段落分配', value: 'segment' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source" label="来源标识">
                <Input placeholder="批量操作 / 操作人ID" disabled={batchProgress.running} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="activeRange" label="生效时间范围">
            <DatePicker.RangePicker
              showTime
              style={{ width: '100%' }}
              placeholder={['开始时间（可选）', '结束时间（可选）']}
              disabled={batchProgress.running}
            />
          </Form.Item>
        </Form>

        {/* 批量进度 */}
        {(batchProgress.running || batchProgress.completed > 0) && (
          <div style={{ marginTop: 16 }}>
            <Progress
              percent={
                batchProgress.total > 0
                  ? Math.round((batchProgress.completed / batchProgress.total) * 100)
                  : 0
              }
              status={
                batchProgress.running
                  ? 'active'
                  : batchProgress.failed > 0
                    ? 'exception'
                    : 'success'
              }
            />
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={8}>
                <Statistic
                  title="成功"
                  value={batchProgress.succeeded}
                  suffix={`/ ${batchProgress.total}`}
                  valueStyle={{ color: '#52c41a', fontSize: 16 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="失败"
                  value={batchProgress.failed}
                  valueStyle={{
                    color: batchProgress.failed > 0 ? '#ff4d4f' : '#999',
                    fontSize: 16,
                  }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="进度"
                  value={batchProgress.completed}
                  suffix={`/ ${batchProgress.total}`}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
            </Row>

            {batchProgress.errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 12 }}
                message={`${batchProgress.errors.length} 个用户分配失败`}
                description={
                  <div style={{ maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                    {batchProgress.errors.map((e, i) => (
                      <div key={i}>
                        <Typography.Text code>{e.userId}</Typography.Text>
                        <span style={{ color: '#ff4d4f', marginLeft: 8 }}>{e.error}</span>
                      </div>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

export default StrategyDetail;
