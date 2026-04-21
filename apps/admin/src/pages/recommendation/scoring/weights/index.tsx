import React, { useState, useCallback } from 'react';
import {
  Card,
  Tabs,
  InputNumber,
  Button,
  Space,
  Alert,
  Tag,
  Spin,
  Tooltip,
  Typography,
  Row,
  Col,
  Divider,
  Progress,
  Table,
  Modal,
  message,
} from 'antd';
import {
  InfoCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useDailyScoreWeights,
  useUpdateDailyScoreWeights,
  SCORE_DIMENSIONS,
  SCORE_DIMENSION_LABELS,
  SCORE_DIMENSION_DESCRIPTIONS,
  GOAL_TYPE_LABELS,
  type DailyScoreWeightsConfig,
} from '@/services/scoringConfigService';

const { Text, Title, Paragraph } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'scoring-weights',
  title: '每日评分权重',
  icon: 'BarChartOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 维度颜色 ====================

const DIM_COLORS: Record<string, string> = {
  energy: '#4096ff',
  proteinRatio: '#52c41a',
  macroBalance: '#faad14',
  foodQuality: '#722ed1',
  satiety: '#13c2c2',
  stability: '#eb2f96',
  glycemicImpact: '#fa541c',
  mealQuality: '#1677ff',
};

// ==================== 权重总和校验 ====================

function computeSum(weights: Record<string, number>): number {
  return Object.values(weights).reduce((a, b) => a + (b || 0), 0);
}

function SumIndicator({ sum }: { sum: number }) {
  const rounded = Math.round(sum * 1000) / 1000;
  const isOk = rounded >= 0.95 && rounded <= 1.05;
  return (
    <Space>
      <Text strong>权重总和：</Text>
      <Tag
        color={isOk ? 'success' : 'error'}
        icon={isOk ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
      >
        {rounded.toFixed(4)}
      </Tag>
      {!isOk && (
        <Text type="danger" style={{ fontSize: 12 }}>
          总和必须在 0.95 ~ 1.05 之间
        </Text>
      )}
    </Space>
  );
}

// ==================== 单目标类型权重编辑表格 ====================

interface WeightEditorProps {
  goalType: string;
  weights: Record<string, number>;
  defaultWeights: Record<string, number>;
  onChange: (dim: string, val: number) => void;
  onReset: () => void;
}

const WeightEditor: React.FC<WeightEditorProps> = ({
  goalType,
  weights,
  defaultWeights,
  onChange,
  onReset,
}) => {
  const sum = computeSum(weights);

  const columns = [
    {
      title: '维度',
      dataIndex: 'dim',
      width: 140,
      render: (dim: string) => (
        <Space>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: DIM_COLORS[dim] || '#999',
            }}
          />
          <Text strong>
            {SCORE_DIMENSION_LABELS[dim as keyof typeof SCORE_DIMENSION_LABELS] || dim}
          </Text>
        </Space>
      ),
    },
    {
      title: '当前权重',
      dataIndex: 'dim',
      key: 'weight',
      width: 180,
      render: (dim: string) => (
        <InputNumber
          min={0}
          max={1}
          step={0.01}
          precision={4}
          value={weights[dim] ?? defaultWeights[dim] ?? 0}
          onChange={(v) => onChange(dim, v ?? 0)}
          style={{ width: 130 }}
        />
      ),
    },
    {
      title: '占比',
      dataIndex: 'dim',
      key: 'bar',
      render: (dim: string) => {
        const w = weights[dim] ?? 0;
        const pct = sum > 0 ? Math.round((w / sum) * 100) : 0;
        return (
          <Space style={{ width: 200 }}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={DIM_COLORS[dim] || '#1677ff'}
              style={{ width: 160 }}
              format={(p) => `${p}%`}
            />
          </Space>
        );
      },
    },
    {
      title: '默认值',
      dataIndex: 'dim',
      key: 'default',
      width: 100,
      render: (dim: string) => (
        <Text type="secondary">{(defaultWeights[dim] ?? 0).toFixed(4)}</Text>
      ),
    },
    {
      title: <Tooltip title="当前值和默认值的差异">变化</Tooltip>,
      dataIndex: 'dim',
      key: 'diff',
      width: 100,
      render: (dim: string) => {
        const curr = weights[dim] ?? 0;
        const def = defaultWeights[dim] ?? 0;
        const diff = curr - def;
        if (Math.abs(diff) < 0.0001) return <Text type="secondary">—</Text>;
        return (
          <Text type={diff > 0 ? 'success' : 'danger'}>
            {diff > 0 ? '+' : ''}
            {diff.toFixed(4)}
          </Text>
        );
      },
    },
    {
      title: '说明',
      dataIndex: 'dim',
      key: 'desc',
      render: (dim: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {SCORE_DIMENSION_DESCRIPTIONS[dim as keyof typeof SCORE_DIMENSION_DESCRIPTIONS]}
        </Text>
      ),
    },
  ];

  const dataSource = SCORE_DIMENSIONS.map((dim) => ({ dim, key: dim }));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Row justify="space-between" align="middle">
        <Col>
          <SumIndicator sum={sum} />
        </Col>
        <Col>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              Modal.confirm({
                title: `重置「${GOAL_TYPE_LABELS[goalType] || goalType}」权重为默认值？`,
                content: '将覆盖当前编辑的权重。',
                onOk: onReset,
              });
            }}
          >
            恢复默认值
          </Button>
        </Col>
      </Row>
      <Table columns={columns} dataSource={dataSource} pagination={false} size="small" bordered />
    </Space>
  );
};

// ==================== 健康条件倍数编辑器 ====================

const HEALTH_CONDITION_LABELS: Record<string, string> = {
  diabetes: '糖尿病',
  blood_sugar: '血糖管理',
  hypertension: '高血压',
  kidney: '肾病',
  cholesterol: '高胆固醇',
  cardiovascular: '心血管疾病',
};

interface MultipliersEditorProps {
  multipliers: Record<string, Record<string, number>>;
  onChange: (cond: string, dim: string, val: number) => void;
}

const MultipliersEditor: React.FC<MultipliersEditorProps> = ({ multipliers, onChange }) => {
  const conditions = Object.keys(HEALTH_CONDITION_LABELS);
  const dims = [...SCORE_DIMENSIONS];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Alert
        message="健康条件倍数说明"
        description="倍数 > 1 表示增大该维度权重，倍数 < 1 表示降低。系统会在应用倍数后自动重新归一化。范围：0.1 ~ 5.0。"
        type="info"
        showIcon
      />
      {conditions.map((cond) => (
        <Card
          key={cond}
          size="small"
          title={
            <Space>
              <Tag color="blue">{HEALTH_CONDITION_LABELS[cond] || cond}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                key: {cond}
              </Text>
            </Space>
          }
        >
          <Row gutter={[16, 8]}>
            {dims.map((dim) => {
              const val = multipliers[cond]?.[dim];
              return (
                <Col span={6} key={dim}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ fontSize: 12 }}>
                      {SCORE_DIMENSION_LABELS[dim as keyof typeof SCORE_DIMENSION_LABELS]}
                    </Text>
                    <InputNumber
                      min={0.1}
                      max={5.0}
                      step={0.1}
                      precision={2}
                      value={val ?? 1.0}
                      onChange={(v) => onChange(cond, dim, v ?? 1.0)}
                      style={{ width: '100%' }}
                      placeholder="默认 1.0"
                    />
                  </Space>
                </Col>
              );
            })}
          </Row>
        </Card>
      ))}
    </Space>
  );
};

// ==================== 主页面 ====================

const DailyScoreWeightsPage: React.FC = () => {
  const { data, isLoading } = useDailyScoreWeights();
  const updateMutation = useUpdateDailyScoreWeights();

  // 本地编辑状态
  const [editGoalWeights, setEditGoalWeights] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [editMultipliers, setEditMultipliers] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const [activeGoal, setActiveGoal] = useState('fat_loss');

  // 计算当前展示用的权重（编辑中 > 已保存config > defaults）
  const defaults = data?.defaults;
  const currentConfig = data?.current;

  const effectiveGoalWeights: Record<string, Record<string, number>> = editGoalWeights ??
  currentConfig?.goalWeights ??
  defaults?.goalWeights ??
  {};

  const effectiveMultipliers: Record<string, Record<string, number>> = editMultipliers ??
  currentConfig?.healthConditionMultipliers ??
  defaults?.healthConditionMultipliers ??
  {};

  const isDirty = editGoalWeights !== null || editMultipliers !== null;

  // 更新某目标类型某维度权重
  const handleWeightChange = useCallback(
    (goalType: string, dim: string, val: number) => {
      setEditGoalWeights((prev) => {
        const base = prev ?? currentConfig?.goalWeights ?? defaults?.goalWeights ?? {};
        return {
          ...base,
          [goalType]: {
            ...(base[goalType] ?? {}),
            [dim]: val,
          },
        };
      });
    },
    [currentConfig, defaults]
  );

  // 重置某目标类型为默认值
  const handleResetGoal = useCallback(
    (goalType: string) => {
      const defWeights = defaults?.goalWeights?.[goalType] ?? {};
      setEditGoalWeights((prev) => {
        const base = prev ?? currentConfig?.goalWeights ?? defaults?.goalWeights ?? {};
        return { ...base, [goalType]: { ...defWeights } };
      });
    },
    [currentConfig, defaults]
  );

  // 更新健康条件倍数
  const handleMultiplierChange = useCallback(
    (cond: string, dim: string, val: number) => {
      setEditMultipliers((prev) => {
        const base =
          prev ??
          currentConfig?.healthConditionMultipliers ??
          defaults?.healthConditionMultipliers ??
          {};
        return {
          ...base,
          [cond]: { ...(base[cond] ?? {}), [dim]: val },
        };
      });
    },
    [currentConfig, defaults]
  );

  // 保存
  const handleSave = useCallback(async () => {
    const goalWeightsToSave =
      editGoalWeights ?? currentConfig?.goalWeights ?? defaults?.goalWeights ?? {};
    const multipliersToSave =
      editMultipliers ??
      currentConfig?.healthConditionMultipliers ??
      defaults?.healthConditionMultipliers ??
      {};

    // 前端校验权重总和
    for (const [goalType, weights] of Object.entries(goalWeightsToSave)) {
      const sum = computeSum(weights);
      if (sum < 0.95 || sum > 1.05) {
        message.error(
          `「${GOAL_TYPE_LABELS[goalType] || goalType}」权重总和 ${sum.toFixed(4)} 不在 0.95~1.05 范围内`
        );
        return;
      }
    }

    const config: DailyScoreWeightsConfig = {
      version: `${currentConfig?.version ?? '1.0'}.${Date.now()}`,
      updatedAt: dayjs().toISOString(),
      goalWeights: goalWeightsToSave,
      healthConditionMultipliers: multipliersToSave,
    };

    try {
      await updateMutation.mutateAsync(config);
      message.success('每日评分权重保存成功！配置约 1 分钟后生效。');
      setEditGoalWeights(null);
      setEditMultipliers(null);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string; data?: { errors?: string[] } } };
      };
      const errors = axiosErr?.response?.data?.data?.errors;
      if (errors?.length) {
        Modal.error({
          title: '权重配置验证失败',
          content: (
            <ul style={{ paddingLeft: 16 }}>
              {errors.map((e: string, i: number) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ),
        });
      } else {
        message.error('保存失败，请检查配置后重试');
      }
    }
  }, [editGoalWeights, editMultipliers, currentConfig, defaults, updateMutation]);

  // 放弃修改
  const handleDiscard = () => {
    Modal.confirm({
      title: '放弃所有未保存的修改？',
      onOk: () => {
        setEditGoalWeights(null);
        setEditMultipliers(null);
      },
    });
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="加载评分权重配置..." />
      </div>
    );
  }

  const goalTypes = ['fat_loss', 'muscle_gain', 'health', 'habit'];

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* 页面头部 */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            每日评分权重配置
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            配置不同目标用户的 8 维评分权重，调整后约 1 分钟生效。
          </Paragraph>
        </Col>
        <Col>
          <Space>
            <Tag color={data?.effectiveSource === 'config' ? 'blue' : 'default'}>
              当前来源：{data?.effectiveSource === 'config' ? '自定义配置' : '系统默认值'}
            </Tag>
            {currentConfig?.version && <Tag>版本：{currentConfig.version}</Tag>}
            {currentConfig?.updatedAt && (
              <Tag>更新于：{dayjs(currentConfig.updatedAt).format('YYYY-MM-DD HH:mm')}</Tag>
            )}
          </Space>
        </Col>
      </Row>

      {/* 操作栏 */}
      {isDirty && (
        <Alert
          message="有未保存的修改"
          description="请检查权重总和是否在 0.95~1.05 范围内，然后点击保存。"
          type="warning"
          showIcon
          action={
            <Space>
              <Button size="small" onClick={handleDiscard}>
                放弃修改
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                loading={updateMutation.isPending}
                onClick={handleSave}
              >
                保存配置
              </Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 说明卡片 */}
      <Card
        size="small"
        style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}
      >
        <Row gutter={[16, 8]}>
          <Col span={24}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              <strong>设计原则：</strong>
              评分以用户真实饮食记录为主，权重仅影响各维度的贡献比例。
              用户画像（目标/健康条件）通过"目标类型"和"健康条件倍数"实现个性化，不直接干预评分计算。
              调整权重为零和博弈：提高一个维度必须降低其他维度，总和必须保持 = 1.0。
            </Text>
          </Col>
        </Row>
      </Card>

      {/* 目标类型权重 Tabs */}
      <Card
        title="目标类型权重"
        extra={
          <Tooltip title="每种目标类型对应一套权重，用户按目标匹配对应权重组">
            <InfoCircleOutlined style={{ cursor: 'pointer', color: '#1677ff' }} />
          </Tooltip>
        }
        style={{ marginBottom: 16 }}
      >
        <Tabs
          activeKey={activeGoal}
          onChange={setActiveGoal}
          items={goalTypes.map((goalType) => {
            const weights = effectiveGoalWeights[goalType] ?? {};
            const sum = computeSum(weights);
            const isOk = sum >= 0.95 && sum <= 1.05;
            return {
              key: goalType,
              label: (
                <Space>
                  {GOAL_TYPE_LABELS[goalType] || goalType}
                  {!isOk && editGoalWeights?.[goalType] && (
                    <Tag color="error" style={{ fontSize: 10 }}>
                      总和异常
                    </Tag>
                  )}
                </Space>
              ),
              children: (
                <WeightEditor
                  goalType={goalType}
                  weights={effectiveGoalWeights[goalType] ?? {}}
                  defaultWeights={defaults?.goalWeights?.[goalType] ?? {}}
                  onChange={(dim, val) => handleWeightChange(goalType, dim, val)}
                  onReset={() => handleResetGoal(goalType)}
                />
              ),
            };
          })}
        />
      </Card>

      {/* 健康条件倍数 */}
      <Card
        title="健康条件权重倍数"
        extra={
          <Tooltip title="当用户有特定健康条件时，对应维度权重会按此倍数调整，然后重新归一化">
            <InfoCircleOutlined style={{ cursor: 'pointer', color: '#1677ff' }} />
          </Tooltip>
        }
        style={{ marginBottom: 16 }}
      >
        <MultipliersEditor multipliers={effectiveMultipliers} onChange={handleMultiplierChange} />
      </Card>

      {/* 底部保存按钮 */}
      <Divider />
      <Row justify="end">
        <Col>
          <Space>
            {isDirty && <Button onClick={handleDiscard}>放弃修改</Button>}
            <Button
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              loading={updateMutation.isPending}
              onClick={handleSave}
              disabled={!isDirty}
            >
              保存权重配置
            </Button>
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default DailyScoreWeightsPage;
