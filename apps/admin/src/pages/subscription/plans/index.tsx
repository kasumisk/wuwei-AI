import React, { useRef, useState, useEffect } from 'react';
import {
  Alert,
  Card,
  Button,
  Tag,
  message,
  Modal,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Divider,
  Row,
  Col,
  Spin,
  Tooltip,
  Space,
  Typography,
  Badge,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useSearchParams } from 'react-router-dom';
import {
  subscriptionApi,
  useCreatePlan,
  useUpdatePlan,
  useSubscriptionPlanById,
  type SubscriptionPlanDto,
  type SubscriptionStoreProductInputDto,
  type SubscriptionTier,
  type BillingCycle,
} from '@/services/subscriptionManagementService';

const { Text } = Typography;

// ==================== 常量 ====================

const tierConfig: Record<SubscriptionTier, { color: string; text: string }> = {
  free: { color: 'default', text: '免费' },
  pro: { color: 'blue', text: 'Pro' },
  premium: { color: 'gold', text: 'Premium' },
};

const cycleLabels: Record<BillingCycle, string> = {
  monthly: '月付',
  quarterly: '季付',
  yearly: '年付',
  lifetime: '终身',
};

const currencySymbols: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

const providerOptions = [
  { label: 'RevenueCat', value: 'revenuecat' },
  { label: 'WeChat Pay', value: 'wechat_pay' },
  { label: 'Stripe', value: 'stripe' },
  { label: 'Alipay', value: 'alipay' },
  { label: 'PayPal', value: 'paypal' },
];

const storeOptions = [
  { label: 'App Store', value: 'app_store' },
  { label: 'Google Play', value: 'play_store' },
  { label: 'WeChat', value: 'wechat' },
  { label: 'Stripe', value: 'stripe' },
  { label: 'Alipay', value: 'alipay' },
  { label: 'PayPal', value: 'paypal' },
];

const environmentOptions = [
  { label: 'Production', value: 'production' },
  { label: 'Sandbox', value: 'sandbox' },
];

type MappingFilter =
  | 'all'
  | 'fully_mapped'
  | 'apple_missing'
  | 'google_missing'
  | 'wechat_missing'
  | 'any_missing';

/**
 * 计次配额功能：值为 number，-1 表示无限制
 */
const QUOTA_FEATURES: Array<{ key: string; label: string; tip: string }> = [
  { key: 'recommendation', label: '每日推荐次数', tip: '用户每日可获取推荐的次数，-1 为无限制' },
  { key: 'ai_image_analysis', label: 'AI 图片分析次数', tip: '每日可上传图片进行 AI 分析的次数' },
  { key: 'ai_text_analysis', label: 'AI 文本分析次数', tip: '每日可发起文本分析的次数' },
  { key: 'ai_coach', label: 'AI 教练对话次数', tip: '每日可与 AI 教练对话的次数' },
  {
    key: 'analysis_history',
    label: '分析历史查看条数',
    tip: '可查看的历史分析记录条数，-1 为全量',
  },
];

/**
 * 功能开关：值为 boolean
 */
const CAPABILITY_FEATURES: Array<{ key: string; label: string; tip: string }> = [
  { key: 'detailed_score', label: '详细评分拆解', tip: '是否展示评分详细拆解维度' },
  { key: 'advanced_explain', label: '高级解释', tip: '是否开放高级可解释性分析' },
  { key: 'deep_nutrition', label: '深度营养拆解', tip: '是否展示完整微量营养素和成分占比' },
  {
    key: 'personalized_alternatives',
    label: '个性化替代建议',
    tip: '是否基于用户目标推荐个性化替代食物',
  },
  { key: 'reports', label: '周报/月报', tip: '是否可生成饮食周报和月报' },
  { key: 'full_day_linkage', label: '全天膳食联动', tip: 'V2 跨餐纠偏和下一餐联动建议' },
  { key: 'weekly_plan', label: '周膳食规划', tip: '每周7天膳食计划，仅订阅用户可生成' },
  { key: 'recipe_generation', label: '食谱生成', tip: '是否可生成个性化食谱' },
  { key: 'health_trend', label: '健康趋势分析', tip: '是否可查看长期健康趋势图表' },
  { key: 'priority_ai', label: '优先 AI 响应', tip: '请求优先级高于免费用户' },
  { key: 'behavior_analysis', label: '行为分析', tip: 'V3 用户行为画像、主动提醒、决策反馈' },
  { key: 'coach_style', label: '教练风格选择', tip: 'V5 严格/友善/数据三种 AI 人格切换' },
  { key: 'advanced_challenges', label: '高级挑战', tip: 'V4 高级挑战模式，Free 用户仅可查看' },
];

// ==================== 配额配置 Drawer ====================

interface QuotaDrawerProps {
  planId: string | null;
  onClose: () => void;
}

const QuotaDrawer: React.FC<QuotaDrawerProps> = ({ planId, onClose }) => {
  const [form] = Form.useForm();
  // 每个计次 feature 是否切换为"无限制"
  const [unlimitedMap, setUnlimitedMap] = useState<Record<string, boolean>>({});

  const { data: plan, isLoading } = useSubscriptionPlanById(planId);

  const updateMutation = useUpdatePlan({
    onSuccess: () => {
      message.success('配额配置已保存');
      onClose();
    },
    onError: (err: any) => message.error(`保存失败: ${err.message}`),
  });

  // 套餐加载后初始化表单
  useEffect(() => {
    if (!plan?.entitlements) return;
    const e = plan.entitlements as Record<string, unknown>;

    // 初始化无限制 map
    const newUnlimitedMap: Record<string, boolean> = {};
    QUOTA_FEATURES.forEach(({ key }) => {
      newUnlimitedMap[key] = e[key] === -1;
    });
    setUnlimitedMap(newUnlimitedMap);

    // 设置表单初始值
    const formValues: Record<string, unknown> = {};
    QUOTA_FEATURES.forEach(({ key }) => {
      formValues[`quota_${key}`] = e[key] === -1 ? undefined : (e[key] ?? 0);
    });
    CAPABILITY_FEATURES.forEach(({ key }) => {
      formValues[`cap_${key}`] = !!e[key];
    });
    formValues['data_export'] = e['data_export'] ?? false;

    form.setFieldsValue(formValues);
  }, [plan, form]);

  const handleSave = async () => {
    await form.validateFields();
    const values = form.getFieldsValue();

    const entitlements: Record<string, unknown> = {};

    QUOTA_FEATURES.forEach(({ key }) => {
      entitlements[key] = unlimitedMap[key] ? -1 : (values[`quota_${key}`] ?? 0);
    });
    CAPABILITY_FEATURES.forEach(({ key }) => {
      entitlements[key] = !!values[`cap_${key}`];
    });
    entitlements['data_export'] = values['data_export'];

    updateMutation.mutate({ id: planId!, data: { entitlements } });
  };

  const tierCfg = plan ? tierConfig[plan.tier as SubscriptionTier] : null;

  return (
    <Drawer
      title={
        <Space>
          <SettingOutlined />
          配额配置
          {tierCfg && <Tag color={tierCfg.color}>{tierCfg.text}</Tag>}
          {plan && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {plan.tier} · {cycleLabels[plan.billingCycle as BillingCycle]}
            </Text>
          )}
        </Space>
      }
      open={!!planId}
      width={620}
      onClose={onClose}
      extra={
        <Button type="primary" loading={updateMutation.isPending} onClick={handleSave}>
          保存配置
        </Button>
      }
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin tip="加载配置中..." />
        </div>
      ) : (
        <Form form={form} layout="vertical">
          {/* ===== 计次配额 ===== */}
          <Divider orientation="left" orientationMargin={0}>
            <Space>
              <span style={{ fontWeight: 600 }}>计次配额</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                （每日重置，-1 = 无限制）
              </Text>
            </Space>
          </Divider>

          {QUOTA_FEATURES.map(({ key, label, tip }) => (
            <Row key={key} gutter={12} align="middle" style={{ marginBottom: 16 }}>
              <Col flex="180px">
                <Space>
                  <Text>{label}</Text>
                  <Tooltip title={tip}>
                    <QuestionCircleOutlined style={{ color: '#aaa' }} />
                  </Tooltip>
                </Space>
              </Col>
              <Col flex="120px">
                <Space size={6}>
                  <Switch
                    size="small"
                    checked={!!unlimitedMap[key]}
                    onChange={(val) => {
                      setUnlimitedMap((prev) => ({ ...prev, [key]: val }));
                    }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    无限制
                  </Text>
                </Space>
              </Col>
              <Col flex="auto">
                <Form.Item name={`quota_${key}`} noStyle>
                  <InputNumber
                    min={0}
                    max={99999}
                    disabled={!!unlimitedMap[key]}
                    placeholder={unlimitedMap[key] ? '∞ 无限制' : '次数'}
                    style={{ width: '100%' }}
                    addonAfter="次/天"
                  />
                </Form.Item>
              </Col>
            </Row>
          ))}

          {/* ===== 功能开关 ===== */}
          <Divider orientation="left" orientationMargin={0} style={{ marginTop: 24 }}>
            <Space>
              <SettingOutlined />
              <span style={{ fontWeight: 600 }}>功能开关</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                （能力级控制，开启则解锁对应功能）
              </Text>
            </Space>
          </Divider>

          <Row gutter={[16, 12]}>
            {CAPABILITY_FEATURES.map(({ key, label, tip }) => (
              <Col span={12} key={key}>
                <Form.Item name={`cap_${key}`} valuePropName="checked" noStyle>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      background: '#fafafa',
                    }}
                  >
                    <Form.Item name={`cap_${key}`} valuePropName="checked" noStyle>
                      <Switch size="small" />
                    </Form.Item>
                    <Text style={{ flex: 1, fontSize: 13 }}>{label}</Text>
                    <Tooltip title={tip}>
                      <QuestionCircleOutlined style={{ color: '#ccc' }} />
                    </Tooltip>
                  </div>
                </Form.Item>
              </Col>
            ))}
          </Row>

          {/* ===== 数据导出（三态） ===== */}
          <Divider orientation="left" orientationMargin={0} style={{ marginTop: 24 }}>
            <Space>
              <span style={{ fontWeight: 600 }}>数据导出</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                （混合型：关闭 / CSV / PDF+Excel）
              </Text>
            </Space>
          </Divider>

          <Form.Item name="data_export" label="导出格式权限">
            <Select style={{ width: 240 }}>
              <Select.Option value={false}>
                <Badge status="default" text="不允许导出" />
              </Select.Option>
              <Select.Option value="csv">
                <Badge status="processing" text="允许 CSV 导出" />
              </Select.Option>
              <Select.Option value="pdf_excel">
                <Badge status="success" text="允许 PDF + Excel 导出" />
              </Select.Option>
            </Select>
          </Form.Item>
        </Form>
      )}
    </Drawer>
  );
};

// ==================== 主组件 ====================

const SubscriptionPlanManagement: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlanDto | null>(null);
  const [quotaPlanId, setQuotaPlanId] = useState<string | null>(null);
  const [mappingFilter, setMappingFilter] = useState<MappingFilter>('all');
  const [mappingKeyword, setMappingKeyword] = useState(searchParams.get('productId') ?? '');
  const [matchedOnly, setMatchedOnly] = useState(searchParams.get('matchedOnly') === '1');
  const [rebuildingEntitlements, setRebuildingEntitlements] = useState(false);
  const [form] = Form.useForm();
  const watchedTier = Form.useWatch('tier', form) as SubscriptionTier | undefined;
  const watchedCurrency = (Form.useWatch('currency', form) as string | undefined) ?? 'USD';
  const watchedStoreProducts =
    (Form.useWatch('storeProducts', form) as SubscriptionStoreProductInputDto[] | undefined) ?? [];

  const createMutation = useCreatePlan({
    onSuccess: () => {
      message.success('创建成功');
      setModalVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`创建失败: ${err.message}`),
  });

  const updateMutation = useUpdatePlan({
    onSuccess: () => {
      message.success('更新成功');
      setModalVisible(false);
      setEditingPlan(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`更新失败: ${err.message}`),
  });

  const handleCreate = () => {
    setEditingPlan(null);
    form.resetFields();
    form.setFieldsValue({
      currency: 'USD',
      sortOrder: 0,
      storeProducts: buildDefaultStoreProducts(),
    });
    setModalVisible(true);
  };

  const handleEdit = (record: SubscriptionPlanDto) => {
    setEditingPlan(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      tier: record.tier,
      billingCycle: record.billingCycle,
      priceCents: record.priceCents,
      currency: record.currency,
      storeProducts: normalizeStoreProducts(record.storeProducts),
      sortOrder: record.sortOrder,
      isActive: record.isActive,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const storeProducts = buildStoreProductsPayload(values.storeProducts);
    const payload = {
      ...values,
      storeProducts,
    };

    if (editingPlan) {
      updateMutation.mutate({
        id: editingPlan.id,
        data: {
          name: payload.name,
          description: payload.description,
          currency: payload.currency,
          priceCents: payload.priceCents,
          storeProducts: payload.storeProducts,
          sortOrder: payload.sortOrder,
          isActive: payload.isActive,
        },
      });
    } else {
      createMutation.mutate({
        ...payload,
        entitlements: {},
      });
    }
  };

  const handleRebuildEntitlements = async () => {
    setRebuildingEntitlements(true);
    try {
      const result = await subscriptionApi.rebuildEntitlements();
      message.success(
        result.mode === 'queued'
          ? `已提交后台任务，jobId=${result.jobId || '-'}`
          : `已重建 ${result.result?.subscriptions ?? 0} 个有效订阅的用户权益`,
      );
    } catch (err: any) {
      message.error(`重建失败: ${err.message}`);
    } finally {
      setRebuildingEntitlements(false);
    }
  };

  const requiresProductMapping = watchedTier != null && watchedTier !== 'free';

  const hasMappingValue = (value?: string | null) => (value?.trim().length ?? 0) > 0;

  const buildDefaultStoreProducts = (): SubscriptionStoreProductInputDto[] => [
    {
      provider: 'revenuecat',
      store: 'app_store',
      productId: '',
      offeringId: '',
      packageId: '',
      environment: 'production',
      isActive: true,
    },
    {
      provider: 'revenuecat',
      store: 'play_store',
      productId: '',
      offeringId: '',
      packageId: '',
      environment: 'production',
      isActive: true,
    },
  ];

  const normalizeStoreProducts = (items?: SubscriptionPlanDto['storeProducts']) => {
    if (!items || items.length === 0) return buildDefaultStoreProducts();
    return items.map((item) => ({
      provider: item.provider,
      store: item.store ?? '',
      productId: item.productId,
      offeringId: item.offeringId ?? '',
      packageId: item.packageId ?? '',
      environment: item.environment || 'production',
      isActive: item.isActive,
    }));
  };

  const findStoreProduct = (record: SubscriptionPlanDto, provider: string, store: string) =>
    record.storeProducts?.find(
      (item) => item.provider === provider && item.store === store && item.isActive
    );

  const buildStoreProductsPayload = (
    values: unknown
  ): SubscriptionStoreProductInputDto[] => {
    if (!Array.isArray(values)) return [];
    return values
      .map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        const provider = typeof row.provider === 'string' ? row.provider.trim() : '';
        const store = typeof row.store === 'string' ? row.store.trim() : '';
        const productId = typeof row.productId === 'string' ? row.productId.trim() : '';
        const offeringId = typeof row.offeringId === 'string' ? row.offeringId.trim() : '';
        const packageId = typeof row.packageId === 'string' ? row.packageId.trim() : '';
        const environment =
          typeof row.environment === 'string' && row.environment.trim().length > 0
            ? row.environment.trim()
            : 'production';
        const isActive = row.isActive !== false;
        if (!provider || !store || !productId) return null;
        return {
          provider,
          store,
          productId,
          ...(offeringId ? { offeringId } : {}),
          ...(packageId ? { packageId } : {}),
          environment,
          isActive,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null) as SubscriptionStoreProductInputDto[];
  };

  const getWatchedMappingState = () => {
    const activeRows = watchedStoreProducts.filter(
      (item) =>
        item?.isActive !== false &&
        hasMappingValue(item?.provider) &&
        hasMappingValue(item?.store) &&
        hasMappingValue(item?.productId)
    );
    const hasApple = activeRows.some(
      (item) => item.provider === 'revenuecat' && item.store === 'app_store'
    );
    const hasGoogle = activeRows.some(
      (item) => item.provider === 'revenuecat' && item.store === 'play_store'
    );
    const hasWechat = activeRows.some(
      (item) => item.provider === 'wechat_pay' && item.store === 'wechat'
    );
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const item of activeRows) {
      const key = `${item.provider}::${item.store}::${item.environment || 'production'}`;
      if (seenKeys.has(key)) {
        duplicateKeys.add(key);
      } else {
        seenKeys.add(key);
      }
    }

    return {
      activeRows,
      hasApple,
      hasGoogle,
      hasWechat,
      missingApple: requiresProductMapping && !hasApple,
      missingGoogle: requiresProductMapping && !hasGoogle,
      duplicateKeys: Array.from(duplicateKeys),
    };
  };
  const watchedMappingState = getWatchedMappingState();

  const formatMoney = (priceCents: number, currency: string) => {
    const symbol = currencySymbols[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
    return `${symbol}${(priceCents / 100).toFixed(2)}`;
  };

  const getMappingState = (record: SubscriptionPlanDto) => {
    const requiresMapping = record.tier !== 'free';
    const appleProduct = findStoreProduct(record, 'revenuecat', 'app_store');
    const googleProduct = findStoreProduct(record, 'revenuecat', 'play_store');
    const wechatProduct = findStoreProduct(record, 'wechat_pay', 'wechat');
    const hasApple = hasMappingValue(appleProduct?.productId);
    const hasGoogle = hasMappingValue(googleProduct?.productId);
    const hasWechat = hasMappingValue(wechatProduct?.productId);

    return {
      requiresMapping,
      hasApple,
      hasGoogle,
      hasWechat,
      missingApple: requiresMapping && !hasApple,
      missingGoogle: requiresMapping && !hasGoogle,
      missingWechat: requiresMapping && !hasWechat,
      fullyMapped: !requiresMapping || (hasApple && hasGoogle),
      appleStoreProductId: appleProduct?.productId,
      googleStoreProductId: googleProduct?.productId,
      wechatStoreProductId: wechatProduct?.productId,
      totalMappings: record.storeProducts?.filter((item) => item.isActive).length ?? 0,
    };
  };

  const matchesMappingFilter = (record: SubscriptionPlanDto) => {
    const state = getMappingState(record);
    switch (mappingFilter) {
      case 'fully_mapped':
        return state.requiresMapping && state.fullyMapped;
      case 'apple_missing':
        return state.missingApple;
      case 'google_missing':
        return state.missingGoogle;
      case 'wechat_missing':
        return state.missingWechat;
      case 'any_missing':
        return state.missingApple || state.missingGoogle || state.missingWechat;
      case 'all':
      default:
        return true;
    }
  };

  const matchesMappingKeyword = (record: SubscriptionPlanDto) => {
    const keyword = mappingKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return (
      record.name.toLowerCase().includes(keyword) ||
      record.storeProducts?.some((item) =>
        [item.productId, item.offeringId ?? '', item.packageId ?? '', item.provider, item.store ?? '']
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      ) === true
    );
  };

  const isMatchedMappingItem = (
    item: NonNullable<SubscriptionPlanDto['storeProducts']>[number]
  ) => {
    const keyword = mappingKeyword.trim().toLowerCase();
    if (!keyword) return false;
    return [item.productId, item.offeringId ?? '', item.packageId ?? '', item.provider, item.store ?? '']
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  };

  const columns: ProColumns<SubscriptionPlanDto>[] = [
    {
      title: '套餐等级',
      dataIndex: 'tier',
      width: 100,
      render: (_: unknown, record: SubscriptionPlanDto) => {
        const cfg = tierConfig[record.tier];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: '计费周期',
      dataIndex: 'billingCycle',
      width: 90,
      render: (_: unknown, record: SubscriptionPlanDto) =>
        cycleLabels[record.billingCycle] || record.billingCycle,
    },
    {
      title: '价格',
      dataIndex: 'priceCents',
      width: 110,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <span style={{ fontWeight: 600, color: '#722ed1' }}>
          {formatMoney(record.priceCents, record.currency)}
        </span>
      ),
    },
    {
      title: '商品映射',
      key: 'productMapping',
      width: 260,
      render: (_: unknown, record: SubscriptionPlanDto) => {
        const mappingState = getMappingState(record);
        const visibleMappings =
          record.storeProducts?.filter((item) => {
            if (!item.isActive) return false;
            if (!matchedOnly || !mappingKeyword.trim()) return true;
            return isMatchedMappingItem(item);
          }) ?? [];
        return (
          <Space direction="vertical" size={4}>
            <Space size={6} wrap>
              <Tag
                color={
                  !mappingState.requiresMapping
                    ? 'default'
                    : mappingState.hasApple
                      ? 'success'
                      : 'error'
                }
              >
                Apple{' '}
                {mappingState.requiresMapping ? (mappingState.hasApple ? '已映射' : '缺失') : 'N/A'}
              </Tag>
              <Tag
                color={
                  !mappingState.requiresMapping
                    ? 'default'
                    : mappingState.hasGoogle
                      ? 'success'
                      : 'error'
                }
              >
                Google{' '}
                {mappingState.requiresMapping
                  ? mappingState.hasGoogle
                    ? '已映射'
                    : '缺失'
                  : 'N/A'}
              </Tag>
              <Tag
                color={
                  !mappingState.requiresMapping
                    ? 'default'
                    : mappingState.hasWechat
                      ? 'success'
                      : 'error'
                }
              >
                微信{' '}
                {mappingState.requiresMapping
                  ? mappingState.hasWechat
                    ? '已映射'
                    : '缺失'
                  : 'N/A'}
              </Tag>
            </Space>
            <Text style={{ fontSize: 12 }}>Apple: {mappingState.appleStoreProductId || '-'}</Text>
            <Text style={{ fontSize: 12 }}>
              Google: {mappingState.googleStoreProductId || '-'}
            </Text>
            <Text style={{ fontSize: 12 }}>WeChat: {mappingState.wechatStoreProductId || '-'}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              环境: {findStoreProduct(record, 'revenuecat', 'app_store')?.environment || 'production'}
            </Text>
            {visibleMappings.map((item) => (
                <div
                  key={`${item.provider}-${item.store}-${item.productId}`}
                  style={{
                    fontSize: 12,
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: isMatchedMappingItem(item) ? '#fff7e6' : 'transparent',
                    border: isMatchedMappingItem(item) ? '1px solid #ffd591' : '1px solid transparent',
                  }}
                >
                  <Text style={{ fontSize: 12 }}>
                    {item.provider}/{item.store || '-'}: {item.productId}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.offeringId ? `offering=${item.offeringId}` : 'offering=-'} /{' '}
                    {item.packageId ? `package=${item.packageId}` : 'package=-'}
                  </Text>
                </div>
              ))}
            {matchedOnly &&
              mappingKeyword.trim() &&
              visibleMappings.length === 0 &&
              record.storeProducts?.some((item) => item.isActive) && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  当前套餐没有命中映射明细
                </Text>
              )}
            {mappingState.totalMappings > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {mappingState.totalMappings} 条有效映射
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '配额概览',
      key: 'quotaSummary',
      width: 200,
      render: (_: unknown, record: SubscriptionPlanDto) => {
        const e = (record.entitlements ?? {}) as Record<string, unknown>;
        const imgVal = e['ai_image_analysis'];
        const coachVal = e['ai_coach'];
        const fmt = (v: unknown) => (v === -1 ? '∞' : String(v ?? '—'));
        return (
          <Space size={4} wrap>
            <Tag style={{ fontSize: 11 }}>图片 {fmt(imgVal)}</Tag>
            <Tag style={{ fontSize: 11 }}>教练 {fmt(coachVal)}</Tag>
            {!!e['weekly_plan'] && (
              <Tag color="blue" style={{ fontSize: 11 }}>
                周计划
              </Tag>
            )}
            {!!e['behavior_analysis'] && (
              <Tag color="purple" style={{ fontSize: 11 }}>
                行为分析
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 70,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <Tag color={record.isActive ? 'success' : 'default'}>
          {record.isActive ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateTime',
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setQuotaPlanId(record.id)}
          >
            配额配置
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <ProTable<SubscriptionPlanDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="套餐管理"
        columns={columns}
        search={false}
        request={async () => {
          try {
            const { list } = await subscriptionApi.getPlans();
            const filteredList = (list || []).filter(
              (record) => matchesMappingFilter(record) && matchesMappingKeyword(record)
            );
            return { data: filteredList, total: filteredList.length, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
        toolBarRender={() => [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增套餐
          </Button>,
          <Select
            key="mapping-filter"
            value={mappingFilter}
            style={{ width: 180 }}
            onChange={(value) => {
              setMappingFilter(value);
              actionRef.current?.reload();
            }}
            options={[
              { label: '全部套餐', value: 'all' },
              { label: '已完整映射', value: 'fully_mapped' },
              { label: '缺 Apple 映射', value: 'apple_missing' },
              { label: '缺 Google 映射', value: 'google_missing' },
              { label: '缺微信映射', value: 'wechat_missing' },
              { label: '任一映射缺失', value: 'any_missing' },
            ]}
          />,
          <Input
            key="mapping-keyword"
            value={mappingKeyword}
            style={{ width: 260 }}
            placeholder="搜索 product / offering / package"
            allowClear
            onChange={(event) => {
              const nextValue = event.target.value;
              setMappingKeyword(nextValue);
              const nextParams = new URLSearchParams(searchParams);
              if (nextValue.trim()) {
                nextParams.set('productId', nextValue.trim());
              } else {
                nextParams.delete('productId');
              }
              setSearchParams(nextParams, { replace: true });
              actionRef.current?.reload();
            }}
          />,
          <Switch
            key="matched-only"
            checked={matchedOnly}
            checkedChildren="只看命中"
            unCheckedChildren="显示全部"
            onChange={(checked) => {
              setMatchedOnly(checked);
              const nextParams = new URLSearchParams(searchParams);
              if (checked) {
                nextParams.set('matchedOnly', '1');
              } else {
                nextParams.delete('matchedOnly');
              }
              setSearchParams(nextParams, { replace: true });
              actionRef.current?.reload();
            }}
          />,
          <Button
            key="rebuild-entitlements"
            icon={<ReloadOutlined />}
            loading={rebuildingEntitlements}
            onClick={handleRebuildEntitlements}
          >
            重建权益
          </Button>,
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
        pagination={false}
      />

      {/* ===== 基本信息编辑 Modal ===== */}
      <Modal
        title={editingPlan ? '编辑套餐基本信息' : '新增套餐'}
        open={modalVisible}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onCancel={() => {
          setModalVisible(false);
          setEditingPlan(null);
          form.resetFields();
        }}
        width={860}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {requiresProductMapping &&
            (watchedMappingState.missingApple || watchedMappingState.missingGoogle) && (
              <Alert
                type="warning"
                showIcon
                message="当前为付费套餐，请配置 Apple / Google 商品映射。微信映射仅在大陆支付渠道启用时必需。"
                style={{ marginBottom: 16 }}
              />
            )}
          {requiresProductMapping && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="创建后 RevenueCat 的 app_store / play_store 映射会作为主匹配源。页面现在会完整保存全部 storeProducts，不再丢失额外 provider 映射。"
            />
          )}
          {watchedMappingState.duplicateKeys.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={`存在重复的 provider/store/environment 活跃映射：${watchedMappingState.duplicateKeys.join(', ')}`}
            />
          )}
          <Form.Item
            name="name"
            label="套餐名称"
            rules={[{ required: true, message: '请输入套餐名称' }]}
          >
            <Input placeholder="例如：Pro 月付" />
          </Form.Item>
          <Form.Item name="description" label="套餐描述">
            <Input.TextArea rows={3} placeholder="简要说明套餐价值和适用人群" />
          </Form.Item>
          <Form.Item
            name="tier"
            label="套餐等级"
            rules={[{ required: true, message: '请选择套餐等级' }]}
          >
            <Select disabled={!!editingPlan} placeholder="选择等级">
              <Select.Option value="free">免费</Select.Option>
              <Select.Option value="pro">Pro</Select.Option>
              <Select.Option value="premium">Premium</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="billingCycle"
            label="计费周期"
            rules={[{ required: true, message: '请选择计费周期' }]}
          >
            <Select disabled={!!editingPlan} placeholder="选择周期">
              <Select.Option value="monthly">月付</Select.Option>
              <Select.Option value="quarterly">季付</Select.Option>
              <Select.Option value="yearly">年付</Select.Option>
              <Select.Option value="lifetime">终身</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="priceCents"
            label={
              <Space>
                价格
                <Text type="secondary" style={{ fontSize: 12 }}>
                  （单位：分）
                </Text>
              </Space>
            }
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="例如：499 表示 4.99"
              addonBefore={currencySymbols[watchedCurrency.toUpperCase()] ?? watchedCurrency.toUpperCase()}
            />
          </Form.Item>
          <Form.Item name="currency" label="货币代码" initialValue="USD">
            <Input placeholder="例如：CNY / USD" />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>
            商品映射
          </Divider>
          <Form.List name="storeProducts">
            {(fields, { add, remove }) => (
              <>
                <Space wrap style={{ marginBottom: 16 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      add({
                        provider: 'revenuecat',
                        store: 'app_store',
                        productId: '',
                        offeringId: '',
                        packageId: '',
                        environment: 'production',
                        isActive: true,
                      })
                    }
                  >
                    添加 App Store
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      add({
                        provider: 'revenuecat',
                        store: 'play_store',
                        productId: '',
                        offeringId: '',
                        packageId: '',
                        environment: 'production',
                        isActive: true,
                      })
                    }
                  >
                    添加 Google Play
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      add({
                        provider: 'wechat_pay',
                        store: 'wechat',
                        productId: '',
                        offeringId: '',
                        packageId: '',
                        environment: 'production',
                        isActive: true,
                      })
                    }
                  >
                    添加 WeChat
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      add({
                        provider: 'stripe',
                        store: 'stripe',
                        productId: '',
                        offeringId: '',
                        packageId: '',
                        environment: 'production',
                        isActive: true,
                      })
                    }
                  >
                    添加 Stripe
                  </Button>
                </Space>
                <Space direction="vertical" size={12} style={{ display: 'flex', marginBottom: 16 }}>
                  {fields.map((field) => (
                    <Card key={field.key} size="small" style={{ background: '#fafafa' }}>
                      <Row gutter={12}>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'provider']}
                            label="Provider"
                            rules={[{ required: true, message: '请选择 provider' }]}
                          >
                            <Select options={providerOptions} />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'store']}
                            label="Store"
                            rules={[{ required: true, message: '请选择 store' }]}
                          >
                            <Select options={storeOptions} />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'environment']}
                            label="环境"
                            initialValue="production"
                          >
                            <Select options={environmentOptions} />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'isActive']}
                            label="启用"
                            valuePropName="checked"
                            initialValue={true}
                          >
                            <Switch />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'productId']}
                            label="商品 ID"
                            rules={[{ required: true, message: '请输入商品 ID' }]}
                          >
                            <Input placeholder="例如：eatcheck.monthly.v2" />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'offeringId']}
                            label="Offering ID"
                          >
                            <Input placeholder="例如：default" />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item
                            {...field}
                            name={[field.name, 'packageId']}
                            label="Package ID"
                          >
                            <Input placeholder="例如：\$rc_monthly" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={12} align="middle">
                        <Col span={24}>
                          <Button
                            danger
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(field.name)}
                            style={{ width: '100%' }}
                          >
                            删除
                          </Button>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                </Space>
                <Button
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      provider: 'revenuecat',
                      store: 'app_store',
                      productId: '',
                      offeringId: '',
                      packageId: '',
                      environment: 'production',
                      isActive: true,
                    })
                  }
                >
                  新增商品映射
                </Button>
              </>
            )}
          </Form.List>
          {watchedStoreProducts.length > 0 && (
            <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
              <Space direction="vertical" size={4}>
                <Text strong style={{ fontSize: 12 }}>
                  即将写入的商品映射
                </Text>
                {watchedStoreProducts.map((item, index) => (
                  <Text key={`${item.provider}-${item.store}-${index}`} style={{ fontSize: 12 }}>
                    {item.provider || '-'} / {item.store || '-'} / {item.environment || 'production'}
                    : {item.productId?.trim() || '-'}
                    {(item.offeringId?.trim()?.length ?? 0) > 0 ? ` / offering=${item.offeringId?.trim()}` : ''}
                    {(item.packageId?.trim()?.length ?? 0) > 0 ? ` / package=${item.packageId?.trim()}` : ''}
                    {item.isActive === false ? ' (disabled)' : ''}
                  </Text>
                ))}
              </Space>
            </Card>
          )}
          <Form.Item name="sortOrder" label="排序权重" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editingPlan && (
            <Form.Item name="isActive" label="是否启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* ===== 配额配置 Drawer ===== */}
      <QuotaDrawer
        planId={quotaPlanId}
        onClose={() => {
          setQuotaPlanId(null);
          actionRef.current?.reload();
        }}
      />
    </Card>
  );
};

export default SubscriptionPlanManagement;

export const routeConfig = {
  name: 'subscription-plans',
  title: '套餐管理',
  icon: 'AppstoreOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};
