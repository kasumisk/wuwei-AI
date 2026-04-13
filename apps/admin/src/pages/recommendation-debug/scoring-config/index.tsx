import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Form,
  InputNumber,
  Button,
  Space,
  Spin,
  Tabs,
  message,
  Tooltip,
  Divider,
  Typography,
  Popconfirm,
  Tag,
  Table,
  Alert,
  Modal,
} from 'antd';
import {
  SettingOutlined,
  ReloadOutlined,
  SaveOutlined,
  InfoCircleOutlined,
  RollbackOutlined,
  DiffOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useScoringConfig,
  useUpdateScoringConfig,
  type ScoringConfigSnapshot,
} from '@/services/scoringConfigService';

const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'recommendation-debug-scoring-config',
  title: '评分配置',
  icon: 'SettingOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 工具组件 ====================

const FieldWithTooltip: React.FC<{
  label: string;
  tip: string;
  name: string | string[];
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  defaultValue?: number;
}> = ({ label, tip, name, min, max, step = 0.01, precision = 3, defaultValue }) => (
  <Form.Item
    label={
      <Space size={4}>
        <span>{label}</span>
        <Tooltip title={tip}>
          <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
        </Tooltip>
      </Space>
    }
    name={name}
  >
    <InputNumber
      min={min}
      max={max}
      step={step}
      precision={precision}
      style={{ width: '100%' }}
      placeholder={defaultValue !== undefined ? `默认: ${defaultValue}` : undefined}
    />
  </Form.Item>
);

// ==================== Sigmoid 曲线预览 ====================

const sigmoid = (x: number, center: number, slope: number): number =>
  1 / (1 + Math.exp(-slope * (x - center)));

const SigmoidPreview: React.FC<{
  title: string;
  center: number;
  slope: number;
  defaultCenter: number;
  defaultSlope: number;
  xMin: number;
  xMax: number;
  xLabel: string;
}> = ({ title, center, slope, defaultCenter, defaultSlope, xMin, xMax, xLabel }) => {
  const data = useMemo(() => {
    const points: { x: number; current: number; default: number }[] = [];
    const step = (xMax - xMin) / 60;
    for (let x = xMin; x <= xMax; x += step) {
      points.push({
        x: Math.round(x * 100) / 100,
        current: Math.round(sigmoid(x, center, slope) * 1000) / 1000,
        default: Math.round(sigmoid(x, defaultCenter, defaultSlope) * 1000) / 1000,
      });
    }
    return points;
  }, [center, slope, defaultCenter, defaultSlope, xMin, xMax]);

  const isModified = center !== defaultCenter || slope !== defaultSlope;

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>{title}</span>
          {isModified && <Tag color="warning">已修改</Tag>}
        </Space>
      }
      style={{ marginTop: 12 }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            label={{ value: xLabel, position: 'insideBottomRight', offset: -5 }}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            domain={[0, 1]}
            label={{ value: '输出', angle: -90, position: 'insideLeft' }}
            tick={{ fontSize: 10 }}
          />
          <RechartsTooltip
            formatter={
              ((val: number, name: string) => [
                val.toFixed(3),
                name === 'current' ? '当前' : '默认',
              ]) as any
            }
          />
          <Legend formatter={(v) => (v === 'current' ? '当前' : '默认')} />
          <ReferenceLine x={center} stroke="#1677ff" strokeDasharray="5 5" label="中心" />
          <ReferenceLine y={0.5} stroke="#999" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="current" stroke="#1677ff" strokeWidth={2} dot={false} />
          {isModified && (
            <Line
              type="monotone"
              dataKey="default"
              stroke="#d9d9d9"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>
        中心值={center}，斜率={slope}
        {isModified && (
          <Text type="warning" style={{ marginLeft: 8 }}>
            (默认: 中心值={defaultCenter}, 斜率={defaultSlope})
          </Text>
        )}
      </div>
    </Card>
  );
};

// ==================== 修改差异面板 ====================

interface DiffItem {
  key: string;
  label: string;
  current: unknown;
  default: unknown;
}

const ConfigDiffPanel: React.FC<{
  current: Record<string, unknown>;
  defaults: Record<string, unknown>;
}> = ({ current, defaults }) => {
  const fieldLabels: Record<string, string> = {
    nrf93SigmoidCenter: 'NRF9.3 Sigmoid 中心值',
    nrf93SigmoidSlope: 'NRF9.3 Sigmoid 斜率',
    inflammationCenter: '炎症指数中心值',
    inflammationSlope: '炎症指数斜率',
    addedSugarPenaltyPerGrams: '添加糖惩罚/克',
    confidenceFloor: '置信度下限',
    semanticOnlyWeight: '语义仅有权重',
    cfOnlyWeight: 'CF 仅有权重',
    maxCandidatesPerCategoryForNonRule: '非规则每类最大候选数',
    minCandidates: '最小候选数',
    canteenCommonalityThreshold: '食堂普通度阈值',
    cfUserBasedWeight: 'CF 基于用户权重',
    cfItemBasedWeight: 'CF 基于物品权重',
    replacedFromMultiplier: '被替换食物惩罚乘数',
    replacedToMultiplier: '替换目标奖励乘数',
    replacementDecayDays: '替换反馈衰减天数',
    replacementMinFrequency: '替换最小频次',
    lifestyleSleepPoorTryptophanBoost: '睡眠差-色氨酸提升',
    lifestyleSleepPoorMagnesiumBoost: '睡眠差-镁提升',
    lifestyleStressHighVitCBoost: '压力高-维生素C提升',
  };

  const diffs: DiffItem[] = useMemo(() => {
    const items: DiffItem[] = [];
    const allKeys = new Set([...Object.keys(current), ...Object.keys(defaults)]);
    allKeys.forEach((key) => {
      // Skip nested objects for simple comparison
      if (typeof current[key] === 'object' || typeof defaults[key] === 'object') return;
      if (current[key] !== defaults[key] && current[key] != null && defaults[key] != null) {
        items.push({
          key,
          label: fieldLabels[key] || key,
          current: current[key],
          default: defaults[key],
        });
      }
    });
    return items;
  }, [current, defaults]);

  if (diffs.length === 0) {
    return (
      <Alert message="所有参数均为默认值" type="success" showIcon style={{ marginBottom: 16 }} />
    );
  }

  const columns: ColumnsType<DiffItem> = [
    { title: '参数', dataIndex: 'label', width: 200 },
    {
      title: '当前值',
      dataIndex: 'current',
      width: 120,
      render: (val) => (
        <Text strong style={{ color: '#1677ff' }}>
          {String(val)}
        </Text>
      ),
    },
    {
      title: '默认值',
      dataIndex: 'default',
      width: 120,
      render: (val) => <Text type="secondary">{String(val)}</Text>,
    },
    {
      title: '偏差',
      key: 'diff',
      width: 100,
      render: (_, record) => {
        if (typeof record.current !== 'number' || typeof record.default !== 'number') return '-';
        const diff = record.current - record.default;
        const pct =
          record.default !== 0 ? ((diff / Math.abs(record.default)) * 100).toFixed(1) : '-';
        return (
          <Tag color={diff > 0 ? 'blue' : 'orange'}>
            {diff > 0 ? '+' : ''}
            {typeof diff === 'number' ? diff.toFixed(4) : diff} ({pct}%)
          </Tag>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <DiffOutlined />
          <span>与默认值差异</span>
          <Tag color="warning">{diffs.length} 项</Tag>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Table columns={columns} dataSource={diffs} rowKey="key" size="small" pagination={false} />
    </Card>
  );
};

// ==================== 主页面 ====================

const ScoringConfigPage: React.FC = () => {
  const [form] = Form.useForm<ScoringConfigSnapshot>();
  const { data, isLoading, refetch } = useScoringConfig();
  const { mutateAsync: updateConfig, isPending: isSaving } = useUpdateScoringConfig();
  const [isDirty, setIsDirty] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  // 从后端加载默认值填入表单
  useEffect(() => {
    if (data?.config) {
      form.setFieldsValue(data.config as any);
      setFormValues(data.config as Record<string, unknown>);
      setIsDirty(false);
    }
  }, [data, form]);

  const handleValuesChange = (_: unknown, allValues: Record<string, unknown>) => {
    setIsDirty(true);
    setFormValues(allValues);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const patch: Partial<ScoringConfigSnapshot> = {};
      (Object.keys(values) as Array<keyof ScoringConfigSnapshot>).forEach((k) => {
        if (values[k] !== undefined && values[k] !== null) {
          (patch as Record<string, unknown>)[k] = values[k];
        }
      });
      await updateConfig(patch);
      message.success('评分配置已保存');
      setIsDirty(false);
    } catch {
      message.error('保存失败，请检查表单');
    }
  };

  const handleSaveWithConfirm = () => {
    // Count changes
    const defaults = data?.defaults ?? {};
    const changes: string[] = [];
    Object.keys(formValues).forEach((k) => {
      if (
        typeof formValues[k] !== 'object' &&
        formValues[k] != null &&
        (defaults as Record<string, unknown>)[k] != null &&
        formValues[k] !== (defaults as Record<string, unknown>)[k]
      ) {
        changes.push(k);
      }
    });

    if (changes.length === 0) {
      handleSave();
      return;
    }

    Modal.confirm({
      title: '确认保存评分配置修改',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>即将保存 {changes.length} 项参数修改，这将影响所有用户的推荐评分。</p>
          <Alert
            type="warning"
            message="修改评分配置会立即生效，影响所有推荐结果"
            showIcon
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: '确认保存',
      cancelText: '取消',
      onOk: handleSave,
    });
  };

  const handleResetToDefaults = () => {
    if (data?.defaults) {
      form.setFieldsValue(data.defaults as any);
      setFormValues(data.defaults as Record<string, unknown>);
      setIsDirty(true);
      message.info('已恢复默认值，请点击保存生效');
    }
  };

  const defaults = data?.defaults ?? {};
  const nrf93Center =
    (formValues.nrf93SigmoidCenter as number) ?? (defaults.nrf93SigmoidCenter as number) ?? 200;
  const nrf93Slope =
    (formValues.nrf93SigmoidSlope as number) ?? (defaults.nrf93SigmoidSlope as number) ?? 0.02;
  const inflCenter =
    (formValues.inflammationCenter as number) ?? (defaults.inflammationCenter as number) ?? 50;
  const inflSlope =
    (formValues.inflammationSlope as number) ?? (defaults.inflammationSlope as number) ?? 0.1;

  return (
    <Spin spinning={isLoading}>
      {/* 差异面板 (常驻) */}
      {data && (
        <ConfigDiffPanel
          current={formValues}
          defaults={(data.defaults ?? {}) as Record<string, unknown>}
        />
      )}

      <Form form={form} layout="vertical" onValuesChange={handleValuesChange} size="small">
        {/* 操作栏 */}
        <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '8px 16px' }}>
          <Space>
            {isDirty && <Tag color="warning">有未保存的修改</Tag>}
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
              刷新
            </Button>
            <Popconfirm
              title="将所有参数恢复为系统默认值？"
              onConfirm={handleResetToDefaults}
              okText="恢复"
              cancelText="取消"
            >
              <Button icon={<RollbackOutlined />} danger>
                恢复默认
              </Button>
            </Popconfirm>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveWithConfirm}
              loading={isSaving}
              disabled={!isDirty}
            >
              保存修改
            </Button>
          </Space>
        </Card>

        <Tabs
          type="card"
          items={[
            // ==================== Tab 1: 营养评分 ====================
            {
              key: 'nutrition',
              label: '营养评分',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        NRF9.3 评分 Sigmoid
                      </Divider>
                      <FieldWithTooltip
                        label="Sigmoid 中心值"
                        tip="NRF9.3 分数在此值时 sigmoid 输出 0.5"
                        name="nrf93SigmoidCenter"
                        min={50}
                        max={500}
                        step={10}
                        precision={0}
                        defaultValue={defaults.nrf93SigmoidCenter as number}
                      />
                      <FieldWithTooltip
                        label="Sigmoid 斜率"
                        tip="斜率越大，分数差异敏感度越高"
                        name="nrf93SigmoidSlope"
                        min={0.001}
                        max={0.1}
                        step={0.001}
                        precision={4}
                        defaultValue={defaults.nrf93SigmoidSlope as number}
                      />
                      <SigmoidPreview
                        title="NRF9.3 Sigmoid 曲线预览"
                        center={nrf93Center}
                        slope={nrf93Slope}
                        defaultCenter={(defaults.nrf93SigmoidCenter as number) ?? 200}
                        defaultSlope={(defaults.nrf93SigmoidSlope as number) ?? 0.02}
                        xMin={0}
                        xMax={500}
                        xLabel="NRF9.3 分数"
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        炎症 & 糖分惩罚
                      </Divider>
                      <FieldWithTooltip
                        label="炎症指数中心值"
                        tip="炎症指数在此值时输出 0.5"
                        name="inflammationCenter"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.inflammationCenter as number}
                      />
                      <FieldWithTooltip
                        label="炎症指数斜率"
                        tip="斜率越大，炎症高的食物惩罚越重"
                        name="inflammationSlope"
                        min={0.01}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={defaults.inflammationSlope as number}
                      />
                      <FieldWithTooltip
                        label="添加糖惩罚（每克）"
                        tip="每克添加糖扣减分数"
                        name="addedSugarPenaltyPerGrams"
                        min={0}
                        max={50}
                        step={1}
                        precision={0}
                        defaultValue={defaults.addedSugarPenaltyPerGrams as number}
                      />
                      <SigmoidPreview
                        title="炎症指数 Sigmoid 曲线预览"
                        center={inflCenter}
                        slope={inflSlope}
                        defaultCenter={(defaults.inflammationCenter as number) ?? 50}
                        defaultSlope={(defaults.inflammationSlope as number) ?? 0.1}
                        xMin={0}
                        xMax={100}
                        xLabel="炎症指数"
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        置信度 & NOVA
                      </Divider>
                      <FieldWithTooltip
                        label="置信度下限"
                        tip="最低置信度乘数，防止数据稀少时分数过低"
                        name="confidenceFloor"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.confidenceFloor as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 2: 推荐召回 & 合并 ====================
            {
              key: 'recall',
              label: '召回 & 合并',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        召回权重
                      </Divider>
                      <FieldWithTooltip
                        label="语义仅有权重"
                        tip="仅语义召回（无 CF）时的分数权重"
                        name="semanticOnlyWeight"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.semanticOnlyWeight as number}
                      />
                      <FieldWithTooltip
                        label="CF 仅有权重"
                        tip="仅 CF 召回（无语义）时的分数权重"
                        name="cfOnlyWeight"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cfOnlyWeight as number}
                      />
                      <FieldWithTooltip
                        label="非规则每类最大候选数"
                        tip="非规则召回时每个食物类别最多保留的候选数"
                        name="maxCandidatesPerCategoryForNonRule"
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={defaults.maxCandidatesPerCategoryForNonRule as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        现实性过滤
                      </Divider>
                      <FieldWithTooltip
                        label="最小候选数"
                        tip="过滤后至少保留的候选食物数量"
                        name="minCandidates"
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={defaults.minCandidates as number}
                      />
                      <FieldWithTooltip
                        label="食堂普通度阈值"
                        tip="食堂模式下，普通度低于此值的食物被过滤"
                        name="canteenCommonalityThreshold"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.canteenCommonalityThreshold as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        协同过滤权重
                      </Divider>
                      <FieldWithTooltip
                        label="CF 基于用户权重"
                        tip="User-Based CF 与 Item-Based CF 的权重分配"
                        name="cfUserBasedWeight"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cfUserBasedWeight as number}
                      />
                      <FieldWithTooltip
                        label="CF 基于物品权重"
                        tip="Item-Based CF 权重（通常与 cfUserBasedWeight 互补）"
                        name="cfItemBasedWeight"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cfItemBasedWeight as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 3: 反馈学习 ====================
            {
              key: 'feedback',
              label: '反馈学习',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        替换反馈权重
                      </Divider>
                      <FieldWithTooltip
                        label="被替换食物惩罚乘数"
                        tip="被用户替换的食物，其分数乘以此系数（< 1 = 降权）"
                        name="replacedFromMultiplier"
                        min={0.1}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.replacedFromMultiplier as number}
                      />
                      <FieldWithTooltip
                        label="替换目标食物奖励乘数"
                        tip="用户选择替换的目标食物，其分数乘以此系数（> 1 = 升权）"
                        name="replacedToMultiplier"
                        min={1}
                        max={2}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.replacedToMultiplier as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        衰减 & 阈值
                      </Divider>
                      <FieldWithTooltip
                        label="替换反馈衰减天数"
                        tip="替换信号在此天数后完全衰减到 0"
                        name="replacementDecayDays"
                        min={7}
                        max={180}
                        step={7}
                        precision={0}
                        defaultValue={defaults.replacementDecayDays as number}
                      />
                      <FieldWithTooltip
                        label="替换最小频次"
                        tip="至少被替换多少次才触发惩罚权重"
                        name="replacementMinFrequency"
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={defaults.replacementMinFrequency as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 4: 生活方式调节 ====================
            {
              key: 'lifestyle',
              label: '生活方式调节',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        睡眠 & 压力调节
                      </Divider>
                      <FieldWithTooltip
                        label="睡眠差 - 色氨酸提升"
                        tip="睡眠质量差时，富含色氨酸食物的分数提升量"
                        name="lifestyleSleepPoorTryptophanBoost"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.lifestyleSleepPoorTryptophanBoost as number}
                      />
                      <FieldWithTooltip
                        label="睡眠差 - 镁提升"
                        tip="睡眠质量差时，富含镁食物的分数提升量"
                        name="lifestyleSleepPoorMagnesiumBoost"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.lifestyleSleepPoorMagnesiumBoost as number}
                      />
                      <FieldWithTooltip
                        label="压力高 - 维生素C提升"
                        tip="压力较高时，富含维生素 C 食物的分数提升量"
                        name="lifestyleStressHighVitCBoost"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.lifestyleStressHighVitCBoost as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 5: 可执行性子权重 ====================
            {
              key: 'executability',
              label: '可执行性',
              children: (
                <Card size="small">
                  <Alert
                    message="可执行性分数由4个子维度加权求和，权重总和建议为 1.0"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        可执行性子权重
                      </Divider>
                      <FieldWithTooltip
                        label="常见度权重"
                        tip="食物的普及程度权重 (commonality)"
                        name={['executabilitySubWeights', 'commonality']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.executabilitySubWeights as any)?.commonality}
                      />
                      <FieldWithTooltip
                        label="成本权重"
                        tip="食物价格成本的权重 (cost)"
                        name={['executabilitySubWeights', 'cost']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.executabilitySubWeights as any)?.cost}
                      />
                      <FieldWithTooltip
                        label="烹饪时间权重"
                        tip="烹饪所需时间的权重 (cookTime)"
                        name={['executabilitySubWeights', 'cookTime']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.executabilitySubWeights as any)?.cookTime}
                      />
                      <FieldWithTooltip
                        label="技能要求权重"
                        tip="烹饪技能要求的权重 (skill)"
                        name={['executabilitySubWeights', 'skill']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.executabilitySubWeights as any)?.skill}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 6: 套餐组合权重 ====================
            {
              key: 'composition',
              label: '套餐组合',
              children: (
                <Card size="small">
                  <Alert
                    message="套餐组合评分的5个维度权重，影响多食物搭配方案的最终得分"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        组合评分权重
                      </Divider>
                      <FieldWithTooltip
                        label="食材多样性权重"
                        tip="不同食材种类的多样性评分权重"
                        name={['compositionWeights', 'ingredientDiversity']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.compositionWeights as any)?.ingredientDiversity}
                      />
                      <FieldWithTooltip
                        label="烹饪方式多样性权重"
                        tip="不同烹饪方式（蒸/煮/炒/烤）的多样性评分权重"
                        name={['compositionWeights', 'cookingMethodDiversity']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.compositionWeights as any)?.cookingMethodDiversity}
                      />
                      <FieldWithTooltip
                        label="风味和谐权重"
                        tip="食物之间风味搭配和谐度的评分权重"
                        name={['compositionWeights', 'flavorHarmony']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.compositionWeights as any)?.flavorHarmony}
                      />
                      <FieldWithTooltip
                        label="营养互补权重"
                        tip="食物间营养素互补性的评分权重"
                        name={['compositionWeights', 'nutritionComplementarity']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={
                          (defaults.compositionWeights as any)?.nutritionComplementarity
                        }
                      />
                      <FieldWithTooltip
                        label="口感多样性权重"
                        tip="食物口感（脆/软/嚼劲）多样性的评分权重"
                        name={['compositionWeights', 'textureDiversity']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.compositionWeights as any)?.textureDiversity}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },
          ]}
        />

        {/* 底部保存按钮 */}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            {isDirty && (
              <Text type="warning">
                <SettingOutlined /> 有未保存的修改
              </Text>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveWithConfirm}
              loading={isSaving}
              disabled={!isDirty}
              size="middle"
            >
              保存评分配置
            </Button>
          </Space>
        </div>
      </Form>
    </Spin>
  );
};

export default ScoringConfigPage;
