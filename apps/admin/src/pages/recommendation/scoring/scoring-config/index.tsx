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
  title: '推荐评分配置',
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

            // ==================== Tab 7: NOVA & 能量 ====================
            {
              key: 'nova-energy',
              label: 'NOVA & 能量',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        NOVA 基础分（按等级 1-4）
                      </Divider>
                      <Alert
                        message="NOVA 分级基础分，索引 0~3 对应 NOVA 等级 1~4。等级越高加工度越大，分数越低。"
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, fontSize: 12 }}
                      />
                      <FieldWithTooltip
                        label="NOVA 1 (未加工)"
                        tip="NOVA 等级 1 的基础品质分（最高）"
                        name={['novaBase', 0]}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.novaBase as number[])?.[0]}
                      />
                      <FieldWithTooltip
                        label="NOVA 2 (加工食材)"
                        tip="NOVA 等级 2 的基础品质分"
                        name={['novaBase', 1]}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.novaBase as number[])?.[1]}
                      />
                      <FieldWithTooltip
                        label="NOVA 3 (加工食品)"
                        tip="NOVA 等级 3 的基础品质分"
                        name={['novaBase', 2]}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.novaBase as number[])?.[2]}
                      />
                      <FieldWithTooltip
                        label="NOVA 4 (超加工)"
                        tip="NOVA 等级 4 的基础品质分（最低）"
                        name={['novaBase', 3]}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.novaBase as number[])?.[3]}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        NOVA 微调参数
                      </Divider>
                      <FieldWithTooltip
                        label="高纤维减免阈值 (g)"
                        tip="高纤维食物可减轻 NOVA 惩罚，纤维含量需高于此阈值"
                        name="novaHighFiberThreshold"
                        min={0}
                        max={20}
                        step={0.5}
                        precision={1}
                        defaultValue={defaults.novaHighFiberThreshold as number}
                      />
                      <FieldWithTooltip
                        label="高纤维减免量"
                        tip="满足高纤维阈值后，NOVA 分数加回的量"
                        name="novaHighFiberRelief"
                        min={0}
                        max={0.3}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaHighFiberRelief as number}
                      />
                      <FieldWithTooltip
                        label="低糖减免阈值 (g)"
                        tip="低添加糖食物的减免阈值"
                        name="novaLowSugarThreshold"
                        min={0}
                        max={20}
                        step={0.5}
                        precision={1}
                        defaultValue={defaults.novaLowSugarThreshold as number}
                      />
                      <FieldWithTooltip
                        label="低糖减免量"
                        tip="满足低糖阈值后分数加回量"
                        name="novaLowSugarRelief"
                        min={0}
                        max={0.3}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaLowSugarRelief as number}
                      />
                      <FieldWithTooltip
                        label="低饱和脂肪减免阈值 (g)"
                        tip="低饱和脂肪食物的减免阈值"
                        name="novaLowSatFatThreshold"
                        min={0}
                        max={10}
                        step={0.5}
                        precision={1}
                        defaultValue={defaults.novaLowSatFatThreshold as number}
                      />
                      <FieldWithTooltip
                        label="低饱和脂肪减免量"
                        tip="满足低饱和脂肪阈值后分数加回量"
                        name="novaLowSatFatRelief"
                        min={0}
                        max={0.3}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaLowSatFatRelief as number}
                      />
                      <FieldWithTooltip
                        label="高钠惩罚阈值 (mg)"
                        tip="钠含量高于此阈值时额外惩罚"
                        name="novaHighSodiumThreshold"
                        min={0}
                        max={2000}
                        step={50}
                        precision={0}
                        defaultValue={defaults.novaHighSodiumThreshold as number}
                      />
                      <FieldWithTooltip
                        label="高钠惩罚量"
                        tip="超过高钠阈值时扣减的分数"
                        name="novaHighSodiumPenalty"
                        min={0}
                        max={0.3}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaHighSodiumPenalty as number}
                      />
                      <FieldWithTooltip
                        label="NOVA 分数下限"
                        tip="NOVA 品质分的最小值（Clamp）"
                        name="novaClampMin"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaClampMin as number}
                      />
                      <FieldWithTooltip
                        label="NOVA 分数上限"
                        tip="NOVA 品质分的最大值（Clamp）"
                        name="novaClampMax"
                        min={0.5}
                        max={1}
                        step={0.01}
                        precision={2}
                        defaultValue={defaults.novaClampMax as number}
                      />
                    </Col>
                  </Row>

                  <Divider />

                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        能量 Sigma 比率（按目标类型）
                      </Divider>
                      <Alert
                        message="控制不同目标类型下能量偏差的敏感度。值越大，偏离目标热量时惩罚越重。"
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, fontSize: 12 }}
                      />
                      <FieldWithTooltip
                        label="减脂 Sigma 比率"
                        tip="减脂目标的能量偏差 sigma 比率"
                        name={['energySigmaRatios', 'fat_loss']}
                        min={0.01}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.energySigmaRatios as Record<string, number>)?.fat_loss}
                      />
                      <FieldWithTooltip
                        label="增肌 Sigma 比率"
                        tip="增肌目标的能量偏差 sigma 比率"
                        name={['energySigmaRatios', 'muscle_gain']}
                        min={0.01}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.energySigmaRatios as Record<string, number>)?.muscle_gain}
                      />
                      <FieldWithTooltip
                        label="健康 Sigma 比率"
                        tip="健康目标的能量偏差 sigma 比率"
                        name={['energySigmaRatios', 'health']}
                        min={0.01}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.energySigmaRatios as Record<string, number>)?.health}
                      />
                      <FieldWithTooltip
                        label="习惯 Sigma 比率"
                        tip="习惯养成目标的能量偏差 sigma 比率"
                        name={['energySigmaRatios', 'habit']}
                        min={0.01}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.energySigmaRatios as Record<string, number>)?.habit}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        能量评分参数
                      </Divider>
                      <FieldWithTooltip
                        label="减脂能量惩罚系数"
                        tip="减脂目标下超出热量时的额外惩罚倍数"
                        name="energyFatLossPenalty"
                        min={1}
                        max={5}
                        step={0.1}
                        precision={1}
                        defaultValue={defaults.energyFatLossPenalty as number}
                      />
                      <FieldWithTooltip
                        label="增肌能量惩罚系数"
                        tip="增肌目标下热量不足时的额外惩罚倍数"
                        name="energyMuscleGainPenalty"
                        min={1}
                        max={5}
                        step={0.1}
                        precision={1}
                        defaultValue={defaults.energyMuscleGainPenalty as number}
                      />
                      <FieldWithTooltip
                        label="能量默认分"
                        tip="无法计算能量匹配时的默认得分"
                        name="energyDefaultScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.energyDefaultScore as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 8: 蛋白质 & GI/GL ====================
            {
              key: 'protein-gi',
              label: '蛋白质 & GI/GL',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        蛋白质评分参数
                      </Divider>
                      <FieldWithTooltip
                        label="蛋白质默认分"
                        tip="无法计算蛋白质匹配时的默认得分"
                        name="proteinDefaultScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.proteinDefaultScore as number}
                      />
                      <FieldWithTooltip
                        label="蛋白质不足衰减系数"
                        tip="蛋白质低于目标范围时的衰减系数"
                        name="proteinBelowRangeCoeff"
                        min={0}
                        max={5}
                        step={0.1}
                        precision={2}
                        defaultValue={defaults.proteinBelowRangeCoeff as number}
                      />
                      <FieldWithTooltip
                        label="蛋白质不足基础分"
                        tip="蛋白质不足时的基础保底分"
                        name="proteinBelowRangeBase"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.proteinBelowRangeBase as number}
                      />
                      <FieldWithTooltip
                        label="蛋白质过量衰减速率"
                        tip="蛋白质超过目标范围后分数衰减的速率"
                        name="proteinAboveRangeDecay"
                        min={0}
                        max={5}
                        step={0.1}
                        precision={2}
                        defaultValue={defaults.proteinAboveRangeDecay as number}
                      />
                      <FieldWithTooltip
                        label="蛋白质过量衰减除数"
                        tip="过量蛋白质按此除数归一化后进行衰减"
                        name="proteinAboveRangeDiv"
                        min={1}
                        max={100}
                        step={1}
                        precision={0}
                        defaultValue={defaults.proteinAboveRangeDiv as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        GI/GL 评分参数
                      </Divider>
                      <FieldWithTooltip
                        label="GI 默认分"
                        tip="无 GI 数据时的默认血糖指数得分"
                        name="giDefaultScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.giDefaultScore as number}
                      />
                      <FieldWithTooltip
                        label="GL Sigmoid 斜率"
                        tip="GL 评分 sigmoid 函数的斜率"
                        name="glSigmoidSlope"
                        min={0.01}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={defaults.glSigmoidSlope as number}
                      />
                      <FieldWithTooltip
                        label="GL Sigmoid 中心值"
                        tip="GL 评分 sigmoid 函数的中心值"
                        name="glSigmoidCenter"
                        min={1}
                        max={50}
                        step={1}
                        precision={0}
                        defaultValue={defaults.glSigmoidCenter as number}
                      />
                      <FieldWithTooltip
                        label="GI 回退值"
                        tip="无 GI 数据时使用的回退 GI 值"
                        name="giFallback"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.giFallback as number}
                      />
                      <FieldWithTooltip
                        label="GI 加工步骤加成"
                        tip="每个加工步骤增加的 GI 值"
                        name="giProcessingStep"
                        min={0}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={defaults.giProcessingStep as number}
                      />
                      <FieldWithTooltip
                        label="纤维 GI 减低量"
                        tip="每克纤维减低的 GI 值"
                        name="giFiberReduction"
                        min={0}
                        max={5}
                        step={0.1}
                        precision={1}
                        defaultValue={defaults.giFiberReduction as number}
                      />
                      <FieldWithTooltip
                        label="纤维 GI 减低上限"
                        tip="纤维最多能减低的 GI 总量上限"
                        name="giFiberReductionCap"
                        min={0}
                        max={30}
                        step={1}
                        precision={0}
                        defaultValue={defaults.giFiberReductionCap as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 9: NRF Gap & 炎症公式 ====================
            {
              key: 'nrf-inflammation',
              label: 'NRF Gap & 炎症',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        NRF 9.3 缺口奖励
                      </Divider>
                      <Alert
                        message="当用户某营养素缺口明显时，富含该营养素的食物可获得额外加分"
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, fontSize: 12 }}
                      />
                      <FieldWithTooltip
                        label="缺口阈值"
                        tip="营养素缺口比例高于此阈值时触发奖励"
                        name="nrfGapThreshold"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.nrfGapThreshold as number}
                      />
                      <FieldWithTooltip
                        label="单项最大奖励"
                        tip="单个营养素缺口奖励的最大值"
                        name="nrfGapMaxBonus"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={defaults.nrfGapMaxBonus as number}
                      />
                      <FieldWithTooltip
                        label="总奖励上限"
                        tip="所有营养素缺口奖励的加总上限"
                        name="nrfGapTotalCap"
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={defaults.nrfGapTotalCap as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        炎症公式参数
                      </Divider>
                      <FieldWithTooltip
                        label="反式脂肪除数"
                        tip="反式脂肪对炎症指数的贡献除数"
                        name="inflammTransFatDiv"
                        min={0.1}
                        max={10}
                        step={0.1}
                        precision={1}
                        defaultValue={defaults.inflammTransFatDiv as number}
                      />
                      <FieldWithTooltip
                        label="反式脂肪最大贡献"
                        tip="反式脂肪对炎症的最大贡献值"
                        name="inflammTransFatMax"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.inflammTransFatMax as number}
                      />
                      <FieldWithTooltip
                        label="饱和脂肪除数"
                        tip="饱和脂肪对炎症指数的贡献除数"
                        name="inflammSatFatDiv"
                        min={0.1}
                        max={50}
                        step={1}
                        precision={1}
                        defaultValue={defaults.inflammSatFatDiv as number}
                      />
                      <FieldWithTooltip
                        label="饱和脂肪最大贡献"
                        tip="饱和脂肪对炎症的最大贡献值"
                        name="inflammSatFatMax"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.inflammSatFatMax as number}
                      />
                      <FieldWithTooltip
                        label="纤维除数"
                        tip="纤维对炎症的减缓除数"
                        name="inflammFiberDiv"
                        min={0.1}
                        max={50}
                        step={1}
                        precision={1}
                        defaultValue={defaults.inflammFiberDiv as number}
                      />
                      <FieldWithTooltip
                        label="纤维最大减缓"
                        tip="纤维对炎症的最大减缓值"
                        name="inflammFiberMax"
                        min={0}
                        max={100}
                        step={5}
                        precision={0}
                        defaultValue={defaults.inflammFiberMax as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 10: 烹饪时间 & 默认值 ====================
            {
              key: 'cook-time-defaults',
              label: '烹饪 & 默认值',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        烹饪时间阈值与评分
                      </Divider>
                      <FieldWithTooltip
                        label="快速烹饪阈值 (分钟)"
                        tip="烹饪时间低于此阈值视为快速烹饪"
                        name="cookTimeQuick"
                        min={1}
                        max={30}
                        step={1}
                        precision={0}
                        defaultValue={defaults.cookTimeQuick as number}
                      />
                      <FieldWithTooltip
                        label="快速烹饪得分"
                        tip="快速烹饪食物的基础得分"
                        name="cookTimeQuickScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cookTimeQuickScore as number}
                      />
                      <FieldWithTooltip
                        label="中等烹饪阈值 (分钟)"
                        tip="烹饪时间低于此阈值视为中等"
                        name="cookTimeMedium"
                        min={10}
                        max={60}
                        step={5}
                        precision={0}
                        defaultValue={defaults.cookTimeMedium as number}
                      />
                      <FieldWithTooltip
                        label="中等烹饪得分"
                        tip="中等烹饪时间食物的得分"
                        name="cookTimeMediumScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cookTimeMediumScore as number}
                      />
                      <FieldWithTooltip
                        label="长时间烹饪阈值 (分钟)"
                        tip="烹饪时间低于此阈值视为长时间烹饪"
                        name="cookTimeLong"
                        min={30}
                        max={180}
                        step={10}
                        precision={0}
                        defaultValue={defaults.cookTimeLong as number}
                      />
                      <FieldWithTooltip
                        label="长时间烹饪得分"
                        tip="长时间烹饪食物的得分"
                        name="cookTimeLongScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cookTimeLongScore as number}
                      />
                      <FieldWithTooltip
                        label="免烹饪得分"
                        tip="无需烹饪的食物得分"
                        name="cookTimeZeroScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.cookTimeZeroScore as number}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        杂项默认值
                      </Divider>
                      <FieldWithTooltip
                        label="默认品质分"
                        tip="无品质数据时的默认品质得分"
                        name="defaultQualityScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.defaultQualityScore as number}
                      />
                      <FieldWithTooltip
                        label="默认饱腹感分"
                        tip="无饱腹感数据时的默认得分"
                        name="defaultSatietyScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.defaultSatietyScore as number}
                      />
                      <FieldWithTooltip
                        label="默认碳脂分"
                        tip="碳水/脂肪匹配的默认得分"
                        name="defaultCarbFatScore"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.defaultCarbFatScore as number}
                      />
                      <FieldWithTooltip
                        label="默认置信度"
                        tip="无用户行为数据时的默认置信度"
                        name="defaultConfidence"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.defaultConfidence as number}
                      />
                      <FieldWithTooltip
                        label="默认餐次热量目标 (kcal)"
                        tip="无用户数据时的默认单餐热量目标"
                        name="defaultMealCalorieTarget"
                        min={100}
                        max={2000}
                        step={50}
                        precision={0}
                        defaultValue={defaults.defaultMealCalorieTarget as number}
                      />
                      <FieldWithTooltip
                        label="添加糖最大惩罚"
                        tip="添加糖惩罚的最大值上限"
                        name="maxAddedSugarPenalty"
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={defaults.maxAddedSugarPenalty as number}
                      />
                      <FieldWithTooltip
                        label="范围外惩罚陡度"
                        tip="宏量营养素超出范围时惩罚曲线的陡度"
                        name="rangeOutPenaltySteepness"
                        min={0.1}
                        max={10}
                        step={0.1}
                        precision={1}
                        defaultValue={defaults.rangeOutPenaltySteepness as number}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 11: 跨餐多样性 & 替代权重 ====================
            {
              key: 'diversity-substitution',
              label: '多样性 & 替代',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        跨餐多样性惩罚
                      </Divider>
                      <Alert
                        message="同一天内跨餐次推荐重复食物时的惩罚参数"
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, fontSize: 12 }}
                      />
                      <FieldWithTooltip
                        label="完全相同食物惩罚"
                        tip="同一食物在当天已推荐时的分数乘数"
                        name={['crossMealDiversityPenalties', 'sameFoodPenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.sameFoodPenalty}
                      />
                      <FieldWithTooltip
                        label="同类别惩罚"
                        tip="同食物类别在当天已推荐时的分数乘数"
                        name={['crossMealDiversityPenalties', 'sameCategoryPenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.sameCategoryPenalty}
                      />
                      <FieldWithTooltip
                        label="同烹饪方式惩罚"
                        tip="同烹饪方式在当天已推荐时的分数乘数"
                        name={['crossMealDiversityPenalties', 'sameCookingMethodPenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.sameCookingMethodPenalty}
                      />
                      <FieldWithTooltip
                        label="同口感惩罚"
                        tip="同口感类型在当天已推荐时的分数乘数"
                        name={['crossMealDiversityPenalties', 'sameTexturePenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.sameTexturePenalty}
                      />
                      <FieldWithTooltip
                        label="同风味惩罚"
                        tip="同风味在当天已推荐时的分数乘数"
                        name={['crossMealDiversityPenalties', 'sameFlavorPenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.sameFlavorPenalty}
                      />
                      <FieldWithTooltip
                        label="连续天数惩罚"
                        tip="连续多天推荐同食物时的累计惩罚乘数"
                        name={['crossMealDiversityPenalties', 'consecutiveDayPenalty']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.consecutiveDayPenalty}
                      />
                      <FieldWithTooltip
                        label="最大惩罚天数"
                        tip="惩罚累计的最大天数范围"
                        name={['crossMealDiversityPenalties', 'maxPenaltyDays']}
                        min={1}
                        max={14}
                        step={1}
                        precision={0}
                        defaultValue={(defaults.crossMealDiversityPenalties as any)?.maxPenaltyDays}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        食物替代权重
                      </Divider>
                      <Alert
                        message="计算食物替代相似度时各维度的权重分配"
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, fontSize: 12 }}
                      />
                      <FieldWithTooltip
                        label="营养相似权重"
                        tip="营养成分相似度在替代计算中的权重"
                        name={['substitutionWeights', 'nutrition']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.nutrition}
                      />
                      <FieldWithTooltip
                        label="类别相似权重"
                        tip="食物类别匹配在替代计算中的权重"
                        name={['substitutionWeights', 'category']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.category}
                      />
                      <FieldWithTooltip
                        label="口感相似权重"
                        tip="口感相似度在替代计算中的权重"
                        name={['substitutionWeights', 'texture']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.texture}
                      />
                      <FieldWithTooltip
                        label="烹饪方式相似权重"
                        tip="烹饪方式匹配在替代计算中的权重"
                        name={['substitutionWeights', 'cookingMethod']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.cookingMethod}
                      />
                      <FieldWithTooltip
                        label="风味相似权重"
                        tip="风味匹配在替代计算中的权重"
                        name={['substitutionWeights', 'flavor']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.flavor}
                      />
                      <FieldWithTooltip
                        label="价格相似权重"
                        tip="价格相似度在替代计算中的权重"
                        name={['substitutionWeights', 'price']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.substitutionWeights as any)?.price}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 12: Tuning - Pipeline ====================
            {
              key: 'tuning-pipeline',
              label: 'Tuning: Pipeline',
              children: (
                <Card size="small">
                  <Alert
                    message="v7.5 推荐管线微调参数，影响套餐组装、候选排序、多样性控制等核心行为"
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        套餐组装 - 相似度权重
                      </Divider>
                      <FieldWithTooltip
                        label="类别相似权重"
                        tip="食物类别相似度在组装去重中的权重"
                        name={['tuning', 'similarityWeights', 'category']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.similarityWeights?.category}
                      />
                      <FieldWithTooltip
                        label="烹饪方式权重"
                        tip="烹饪方式相似度在组装去重中的权重"
                        name={['tuning', 'similarityWeights', 'cookingMethod']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.similarityWeights?.cookingMethod}
                      />
                      <FieldWithTooltip
                        label="口感权重"
                        tip="口感相似度在组装去重中的权重"
                        name={['tuning', 'similarityWeights', 'texture']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.similarityWeights?.texture}
                      />
                      <FieldWithTooltip
                        label="风味权重"
                        tip="风味相似度在组装去重中的权重"
                        name={['tuning', 'similarityWeights', 'flavor']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.similarityWeights?.flavor}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        套餐组装 - 多样性 & 兼容性
                      </Divider>
                      <FieldWithTooltip
                        label="多样性相似惩罚"
                        tip="组装时过于相似的食物对的惩罚值"
                        name={['tuning', 'diversitySimilarityPenalty']}
                        min={0}
                        max={1}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.diversitySimilarityPenalty}
                      />
                      <FieldWithTooltip
                        label="兼容性好加分"
                        tip="搭配兼容性好的食物对加分"
                        name={['tuning', 'compatibilityGoodBonus']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.compatibilityGoodBonus}
                      />
                      <FieldWithTooltip
                        label="兼容性差扣分"
                        tip="搭配不兼容的食物对扣分"
                        name={['tuning', 'compatibilityBadPenalty']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.compatibilityBadPenalty}
                      />
                      <FieldWithTooltip
                        label="兼容性 Clamp 下限"
                        tip="兼容性乘数的下限"
                        name={['tuning', 'compatibilityClampMin']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.compatibilityClampMin}
                      />
                      <FieldWithTooltip
                        label="兼容性 Clamp 上限"
                        tip="兼容性乘数的上限"
                        name={['tuning', 'compatibilityClampMax']}
                        min={1}
                        max={3}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.compatibilityClampMax}
                      />
                    </Col>
                  </Row>

                  <Divider />

                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        Pipeline 构建参数
                      </Divider>
                      <FieldWithTooltip
                        label="优化器候选上限"
                        tip="优化器一次处理的最大候选数"
                        name={['tuning', 'optimizerCandidateLimit']}
                        min={10}
                        max={200}
                        step={10}
                        precision={0}
                        defaultValue={(defaults.tuning as any)?.optimizerCandidateLimit}
                      />
                      <FieldWithTooltip
                        label="多样性高乘数"
                        tip="高多样性策略下的分数乘数"
                        name={['tuning', 'diversityHighMultiplier']}
                        min={0.5}
                        max={2}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.diversityHighMultiplier}
                      />
                      <FieldWithTooltip
                        label="多样性低乘数"
                        tip="低多样性策略下的分数乘数"
                        name={['tuning', 'diversityLowMultiplier']}
                        min={0.5}
                        max={2}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.diversityLowMultiplier}
                      />
                      <FieldWithTooltip
                        label="基础探索率"
                        tip="Thompson Sampling 的基础探索概率"
                        name={['tuning', 'baseExplorationRate']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.baseExplorationRate}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        菜品优先级 & 多样性阈值
                      </Divider>
                      <FieldWithTooltip
                        label="菜品优先级除数(场景)"
                        tip="场景模式下菜品优先级的除数"
                        name={['tuning', 'dishPriorityDivisorScene']}
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={(defaults.tuning as any)?.dishPriorityDivisorScene}
                      />
                      <FieldWithTooltip
                        label="菜品优先级除数(普通)"
                        tip="普通模式下菜品优先级的除数"
                        name={['tuning', 'dishPriorityDivisorNormal']}
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={(defaults.tuning as any)?.dishPriorityDivisorNormal}
                      />
                      <FieldWithTooltip
                        label="半成品乘数(场景)"
                        tip="场景模式下半成品食物的分数乘数"
                        name={['tuning', 'semiPreparedMultiplierScene']}
                        min={0}
                        max={2}
                        step={0.1}
                        precision={1}
                        defaultValue={(defaults.tuning as any)?.semiPreparedMultiplierScene}
                      />
                      <FieldWithTooltip
                        label="半成品乘数(普通)"
                        tip="普通模式下半成品食物的分数乘数"
                        name={['tuning', 'semiPreparedMultiplierNormal']}
                        min={0}
                        max={2}
                        step={0.1}
                        precision={1}
                        defaultValue={(defaults.tuning as any)?.semiPreparedMultiplierNormal}
                      />
                      <FieldWithTooltip
                        label="食材多样性阈值"
                        tip="食材多样性高于此值视为多样性充足"
                        name={['tuning', 'ingredientDiversityThreshold']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.ingredientDiversityThreshold}
                      />
                      <FieldWithTooltip
                        label="烹饪方式多样性阈值"
                        tip="烹饪方式多样性高于此值视为多样性充足"
                        name={['tuning', 'cookingMethodDiversityThreshold']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.cookingMethodDiversityThreshold}
                      />
                    </Col>
                  </Row>
                </Card>
              ),
            },

            // ==================== Tab 13: Tuning - 因子 ====================
            {
              key: 'tuning-factors',
              label: 'Tuning: 因子',
              children: (
                <Card size="small">
                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        约束生成器
                      </Divider>
                      <FieldWithTooltip
                        label="蛋白质缺口阈值"
                        tip="蛋白质占比低于此阈值时触发强约束"
                        name={['tuning', 'proteinGapThreshold']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.proteinGapThreshold}
                      />
                      <FieldWithTooltip
                        label="热量缺口阈值"
                        tip="热量占比低于此阈值时触发强约束"
                        name={['tuning', 'calorieGapThreshold']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.calorieGapThreshold}
                      />
                      <FieldWithTooltip
                        label="热量上限乘数"
                        tip="热量软上限 = 目标热量 × 此乘数"
                        name={['tuning', 'calorieCeilingMultiplier']}
                        min={1}
                        max={2}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.calorieCeilingMultiplier}
                      />
                      <FieldWithTooltip
                        label="暴食风险热量乘数"
                        tip="暴食风险用户的热量上限额外乘数"
                        name={['tuning', 'bingeRiskCalorieMultiplier']}
                        min={0.5}
                        max={1.5}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.bingeRiskCalorieMultiplier}
                      />
                      <FieldWithTooltip
                        label="最低蛋白质比例"
                        tip="蛋白质最低占比约束"
                        name={['tuning', 'minProteinRatio']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.minProteinRatio}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        场景上下文因子
                      </Divider>
                      <FieldWithTooltip
                        label="场景加分 Clamp 下限"
                        tip="场景上下文加分的最小值"
                        name={['tuning', 'sceneBoostClampMin']}
                        min={-0.5}
                        max={0}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.sceneBoostClampMin}
                      />
                      <FieldWithTooltip
                        label="场景加分 Clamp 上限"
                        tip="场景上下文加分的最大值"
                        name={['tuning', 'sceneBoostClampMax']}
                        min={0}
                        max={1}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.sceneBoostClampMax}
                      />

                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        分析画像因子
                      </Divider>
                      <FieldWithTooltip
                        label="类别兴趣增量(每次)"
                        tip="每次交互增加的类别兴趣值"
                        name={['tuning', 'categoryInterestPerCount']}
                        min={0}
                        max={0.1}
                        step={0.005}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.categoryInterestPerCount}
                      />
                      <FieldWithTooltip
                        label="类别兴趣上限"
                        tip="类别兴趣的最大值"
                        name={['tuning', 'categoryInterestCap']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.categoryInterestCap}
                      />
                      <FieldWithTooltip
                        label="风险食物惩罚"
                        tip="被标记为风险的食物的惩罚值"
                        name={['tuning', 'riskFoodPenalty']}
                        min={-0.5}
                        max={0}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.riskFoodPenalty}
                      />
                    </Col>
                  </Row>

                  <Divider />

                  <Row gutter={[24, 0]}>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        偏好信号因子
                      </Divider>
                      <FieldWithTooltip
                        label="声明偏好匹配加分"
                        tip="每个匹配的声明偏好增加的分数"
                        name={['tuning', 'declaredPrefPerMatch']}
                        min={0}
                        max={0.2}
                        step={0.005}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.declaredPrefPerMatch}
                      />
                      <FieldWithTooltip
                        label="声明偏好加分上限"
                        tip="声明偏好加分的上限"
                        name={['tuning', 'declaredPrefCap']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.declaredPrefCap}
                      />

                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        生活方式加分因子
                      </Divider>
                      <FieldWithTooltip
                        label="高水分阈值"
                        tip="水分含量高于此阈值的食物可获得加分"
                        name={['tuning', 'factorWaterHighThreshold']}
                        min={0}
                        max={1}
                        step={0.05}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.factorWaterHighThreshold}
                      />
                      <FieldWithTooltip
                        label="营养素加分 Clamp 下限"
                        tip="营养素加分的下限"
                        name={['tuning', 'nutrientBoostClampMin']}
                        min={-0.5}
                        max={0}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.nutrientBoostClampMin}
                      />
                      <FieldWithTooltip
                        label="营养素加分 Clamp 上限"
                        tip="营养素加分的上限"
                        name={['tuning', 'nutrientBoostClampMax']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={2}
                        defaultValue={(defaults.tuning as any)?.nutrientBoostClampMax}
                      />
                      <FieldWithTooltip
                        label="营养素加分 Delta 乘数"
                        tip="营养素差值转换为加分的乘数"
                        name={['tuning', 'nutrientBoostDeltaMultiplier']}
                        min={0}
                        max={5}
                        step={0.1}
                        precision={1}
                        defaultValue={(defaults.tuning as any)?.nutrientBoostDeltaMultiplier}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        短期行为 & 热门度
                      </Divider>
                      <FieldWithTooltip
                        label="短期最少交互次数"
                        tip="短期画像生效所需的最少交互次数"
                        name={['tuning', 'shortTermMinInteractions']}
                        min={1}
                        max={20}
                        step={1}
                        precision={0}
                        defaultValue={(defaults.tuning as any)?.shortTermMinInteractions}
                      />
                      <FieldWithTooltip
                        label="热门度归一化除数"
                        tip="热门度分数的归一化除数"
                        name={['tuning', 'popularityNormalizationDivisor']}
                        min={1}
                        max={1000}
                        step={10}
                        precision={0}
                        defaultValue={(defaults.tuning as any)?.popularityNormalizationDivisor}
                      />

                      <Divider orientation="left" plain style={{ fontSize: 12 }}>
                        FoodScorer 补充
                      </Divider>
                      <FieldWithTooltip
                        label="菜系权重提升系数"
                        tip="用户偏好菜系的食物权重提升系数"
                        name={['tuning', 'cuisineWeightBoostCoeff']}
                        min={0}
                        max={0.5}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.cuisineWeightBoostCoeff}
                      />
                      <FieldWithTooltip
                        label="渠道匹配加分"
                        tip="食物渠道与用户渠道匹配时的额外加分"
                        name={['tuning', 'channelMatchBonus']}
                        min={0}
                        max={0.3}
                        step={0.01}
                        precision={3}
                        defaultValue={(defaults.tuning as any)?.channelMatchBonus}
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
