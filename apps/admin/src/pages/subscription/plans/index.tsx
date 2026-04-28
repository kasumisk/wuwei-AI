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
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  subscriptionApi,
  useCreatePlan,
  useUpdatePlan,
  useSubscriptionPlanById,
  type SubscriptionPlanDto,
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

type MappingFilter = 'all' | 'fully_mapped' | 'apple_missing' | 'wechat_missing' | 'any_missing';

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
  { key: 'full_day_plan', label: '全天膳食规划', tip: 'V2 每日三餐计划功能' },
  { key: 'full_day_linkage', label: '全天膳食联动', tip: 'V2 跨餐纠偏和下一餐联动建议' },
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
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlanDto | null>(null);
  const [quotaPlanId, setQuotaPlanId] = useState<string | null>(null);
  const [mappingFilter, setMappingFilter] = useState<MappingFilter>('all');
  const [form] = Form.useForm();
  const watchedTier = Form.useWatch('tier', form) as SubscriptionTier | undefined;
  const watchedAppleProductId = Form.useWatch('appleProductId', form) as string | undefined;
  const watchedWechatProductId = Form.useWatch('wechatProductId', form) as string | undefined;

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
      appleProductId: record.appleProductId,
      wechatProductId: record.wechatProductId,
      sortOrder: record.sortOrder,
      isActive: record.isActive,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      appleProductId: values.appleProductId?.trim() || undefined,
      wechatProductId: values.wechatProductId?.trim() || undefined,
    };

    if (editingPlan) {
      updateMutation.mutate({
        id: editingPlan.id,
        data: {
          name: payload.name,
          description: payload.description,
          currency: payload.currency,
          priceCents: payload.priceCents,
          appleProductId: payload.appleProductId,
          wechatProductId: payload.wechatProductId,
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

  const requiresProductMapping = watchedTier != null && watchedTier !== 'free';

  const hasMappingValue = (value?: string | null) => (value?.trim().length ?? 0) > 0;

  const buildMappingRules = (label: string) => [
    {
      validator: async (_: unknown, value?: string) => {
        if (!requiresProductMapping || hasMappingValue(value)) return;
        throw new Error(`付费套餐请填写${label}`);
      },
    },
  ];

  const getMappingState = (record: SubscriptionPlanDto) => {
    const requiresMapping = record.tier !== 'free';
    const hasApple = hasMappingValue(record.appleProductId);
    const hasWechat = hasMappingValue(record.wechatProductId);

    return {
      requiresMapping,
      hasApple,
      hasWechat,
      missingApple: requiresMapping && !hasApple,
      missingWechat: requiresMapping && !hasWechat,
      fullyMapped: !requiresMapping || (hasApple && hasWechat),
    };
  };

  const matchesMappingFilter = (record: SubscriptionPlanDto) => {
    const state = getMappingState(record);
    switch (mappingFilter) {
      case 'fully_mapped':
        return state.requiresMapping && state.fullyMapped;
      case 'apple_missing':
        return state.missingApple;
      case 'wechat_missing':
        return state.missingWechat;
      case 'any_missing':
        return state.missingApple || state.missingWechat;
      case 'all':
      default:
        return true;
    }
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
          ¥{(record.priceCents / 100).toFixed(2)}
        </span>
      ),
    },
    {
      title: '商品映射',
      key: 'productMapping',
      width: 260,
      render: (_: unknown, record: SubscriptionPlanDto) => {
        const mappingState = getMappingState(record);
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
            <Text style={{ fontSize: 12 }}>Apple: {record.appleProductId || '-'}</Text>
            <Text style={{ fontSize: 12 }}>WeChat: {record.wechatProductId || '-'}</Text>
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
            {!!e['full_day_plan'] && (
              <Tag color="blue" style={{ fontSize: 11 }}>
                日计划
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
            const filteredList = (list || []).filter(matchesMappingFilter);
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
              { label: '缺微信映射', value: 'wechat_missing' },
              { label: '任一映射缺失', value: 'any_missing' },
            ]}
          />,
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
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {requiresProductMapping &&
            (!hasMappingValue(watchedAppleProductId) ||
              !hasMappingValue(watchedWechatProductId)) && (
              <Alert
                type="warning"
                showIcon
                message="当前为付费套餐，建议同时配置 Apple / 微信商品映射。正式购买验单依赖精确商品 ID。"
                style={{ marginBottom: 16 }}
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
                  （单位：分，1990 = ¥19.90）
                </Text>
              </Space>
            }
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="例如：1990 代表 ¥19.90"
              addonBefore="¥"
              formatter={(v) => (v ? `${(Number(v) / 100).toFixed(2)}` : '')}
              parser={(v) => Math.round(parseFloat(v?.replace('¥', '') || '0') * 100) as any}
            />
          </Form.Item>
          <Form.Item name="currency" label="货币代码" initialValue="CNY">
            <Input placeholder="例如：CNY / USD" />
          </Form.Item>
          <Form.Item
            name="appleProductId"
            label="Apple 商品 ID"
            rules={buildMappingRules('Apple 商品 ID')}
          >
            <Input placeholder="例如：eatcheck.monthly.v2" />
          </Form.Item>
          <Form.Item
            name="wechatProductId"
            label="微信商品 ID"
            rules={buildMappingRules('微信商品 ID')}
          >
            <Input placeholder="例如：pro_monthly" />
          </Form.Item>
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
