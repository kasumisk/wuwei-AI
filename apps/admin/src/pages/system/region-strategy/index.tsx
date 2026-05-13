import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CloudSyncOutlined,
  EditOutlined,
  GlobalOutlined,
  ReloadOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  useRegionStrategies,
  useResetRegionStrategy,
  useUpdateRegionStrategy,
  type AuthMethod,
  type BillingMethod,
  type RegionCapabilityOverride,
  type RegionStrategyConfigView,
  type RuntimeRegion,
} from '@/services/regionStrategyService';

const { Text, Paragraph } = Typography;

export const routeConfig = {
  name: 'system-region-strategy',
  title: '地区策略',
  icon: 'GlobalOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};

const AUTH_OPTIONS: Array<{ label: string; value: AuthMethod }> = [
  { label: 'Apple', value: 'apple' },
  { label: 'Google', value: 'google' },
  { label: 'Email', value: 'email' },
  { label: 'Anonymous', value: 'anonymous' },
  { label: 'Phone', value: 'phone' },
  { label: 'WeChat', value: 'wechat' },
];

const BILLING_OPTIONS: Array<{ label: string; value: BillingMethod }> = [
  { label: 'RevenueCat', value: 'revenuecat' },
  { label: 'Apple IAP', value: 'apple_iap' },
  { label: 'Google Play', value: 'google_play' },
  { label: 'WeChat Pay', value: 'wechat_pay' },
  { label: 'Alipay', value: 'alipay' },
];

const REGION_LABELS: Record<RuntimeRegion, { label: string; color: string }> = {
  GLOBAL: { label: 'Global', color: 'blue' },
  CN: { label: 'China', color: 'red' },
};

const renderTags = (values?: string[]) => {
  if (!values?.length) return <Text type="secondary">未配置</Text>;
  return (
    <Space size={[4, 4]} wrap>
      {values.map((value) => (
        <Tag key={value}>{value}</Tag>
      ))}
    </Space>
  );
};

const toCsv = (values?: string[]) => values?.join(', ') ?? '';
const fromCsv = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

interface RegionFormValues {
  countryCode?: string;
  locale?: string;
  timezone?: string;
  authMethods?: AuthMethod[];
  billingMethods?: BillingMethod[];
  aiProvidersRaw?: string;
  foodTextAnalysisProvider?: string;
  foodTextAnalysisPrimaryModel?: string;
  foodTextAnalysisFallbackModel?: string;
  foodImageAnalysisProvider?: string;
  foodImageAnalysisPrimaryModel?: string;
  foodImageAnalysisFallbackModel?: string;
  storageProvider?: string;
  pushProvidersRaw?: string;
  smsProvider?: string;
  moderationProvider?: string;
  aiFeatures?: {
    foodImageAnalysis?: boolean;
    coachChat?: boolean;
    streaming?: boolean;
  };
  compliance?: {
    piplMode?: boolean;
    dataResidencyRequired?: boolean;
    contentModerationRequired?: boolean;
    medicalDisclaimerRequired?: boolean;
  };
}

const StrategyEditModal: React.FC<{
  open: boolean;
  config: RegionStrategyConfigView | null;
  onClose: () => void;
}> = ({ open, config, onClose }) => {
  const [form] = Form.useForm<RegionFormValues>();
  const { mutateAsync: update, isPending } = useUpdateRegionStrategy();

  useEffect(() => {
    if (!open || !config) return;
    const profile = config.effectiveProfile;
    form.setFieldsValue({
      countryCode: profile.countryCode,
      locale: profile.locale,
      timezone: profile.timezone,
      authMethods: profile.authMethods,
      billingMethods: profile.billingMethods,
      aiProvidersRaw: toCsv(profile.aiProviders),
      foodTextAnalysisProvider: profile.aiModelRouting.foodTextAnalysis.provider,
      foodTextAnalysisPrimaryModel: profile.aiModelRouting.foodTextAnalysis.primaryModel,
      foodTextAnalysisFallbackModel: profile.aiModelRouting.foodTextAnalysis.fallbackModel,
      foodImageAnalysisProvider: profile.aiModelRouting.foodImageAnalysis.provider,
      foodImageAnalysisPrimaryModel: profile.aiModelRouting.foodImageAnalysis.primaryModel,
      foodImageAnalysisFallbackModel: profile.aiModelRouting.foodImageAnalysis.fallbackModel,
      storageProvider: profile.storageProvider,
      pushProvidersRaw: toCsv(profile.pushProviders),
      smsProvider: profile.smsProvider,
      moderationProvider: profile.moderationProvider,
      aiFeatures: profile.aiFeatures,
      compliance: profile.compliance,
    });
  }, [config, form, open]);

  const handleSave = async () => {
    if (!config) return;
    const values = await form.validateFields();
    const payload: RegionCapabilityOverride = {
      countryCode: values.countryCode,
      locale: values.locale,
      timezone: values.timezone,
      authMethods: values.authMethods,
      billingMethods: values.billingMethods,
      aiProviders: fromCsv(values.aiProvidersRaw),
      aiModelRouting: {
        foodTextAnalysis: {
          provider: values.foodTextAnalysisProvider || undefined,
          primaryModel: values.foodTextAnalysisPrimaryModel || '',
          fallbackModel: values.foodTextAnalysisFallbackModel || undefined,
        },
        foodImageAnalysis: {
          provider: values.foodImageAnalysisProvider || undefined,
          primaryModel: values.foodImageAnalysisPrimaryModel || '',
          fallbackModel: values.foodImageAnalysisFallbackModel || undefined,
        },
      },
      storageProvider: values.storageProvider,
      pushProviders: fromCsv(values.pushProvidersRaw),
      smsProvider: values.smsProvider || undefined,
      moderationProvider: values.moderationProvider || undefined,
      aiFeatures: values.aiFeatures,
      compliance: values.compliance,
    };

    await update({ region: config.region, data: payload });
    message.success(`${config.region} 策略已保存`);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={config ? `编辑 ${config.region} Region Strategy` : '编辑 Region Strategy'}
      width={760}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={isPending}
      okText="保存 override"
      cancelText="取消"
    >
      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="保存后会写入该 region 的 override；如需回到代码默认值，请使用页面上的重置按钮。"
      />

      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="Country Code" name="countryCode">
              <Input placeholder="CN" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Locale" name="locale">
              <Input placeholder="zh-CN" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Timezone" name="timezone">
              <Input placeholder="Asia/Shanghai" />
            </Form.Item>
          </Col>
        </Row>

        <Divider plain>AI Model Routing</Divider>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="Text Provider" name="foodTextAnalysisProvider">
              <Input placeholder="deepseek" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Text Primary Model" name="foodTextAnalysisPrimaryModel">
              <Input placeholder="deepseek-chat" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Text Fallback Model" name="foodTextAnalysisFallbackModel">
              <Input placeholder="optional" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="Vision Provider" name="foodImageAnalysisProvider">
              <Input placeholder="openrouter" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Vision Primary Model" name="foodImageAnalysisPrimaryModel">
              <Input placeholder="qwen/qwen3-vl-32b-instruct" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Vision Fallback Model" name="foodImageAnalysisFallbackModel">
              <Input placeholder="qwen/qwen-vl-plus" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Auth Methods" name="authMethods">
              <Select mode="multiple" options={AUTH_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Billing Methods" name="billingMethods">
              <Select mode="multiple" options={BILLING_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="AI Providers（逗号分隔）" name="aiProvidersRaw">
              <Input placeholder="qwen, deepseek" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Push Providers（逗号分隔）" name="pushProvidersRaw">
              <Input placeholder="apns, jpush" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="Storage Provider" name="storageProvider">
              <Input placeholder="gcp / oss / cos" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="SMS Provider" name="smsProvider">
              <Input placeholder="aliyun" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Moderation Provider" name="moderationProvider">
              <Input placeholder="aliyun" />
            </Form.Item>
          </Col>
        </Row>

        <Divider plain>AI Features</Divider>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item
              label="Food Image Analysis"
              name={['aiFeatures', 'foodImageAnalysis']}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="Coach Chat"
              name={['aiFeatures', 'coachChat']}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Streaming" name={['aiFeatures', 'streaming']} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Divider plain>Compliance</Divider>
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item label="PIPL Mode" name={['compliance', 'piplMode']} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              label="Data Residency"
              name={['compliance', 'dataResidencyRequired']}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              label="Content Moderation"
              name={['compliance', 'contentModerationRequired']}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              label="Medical Disclaimer"
              name={['compliance', 'medicalDisclaimerRequired']}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

const RegionCard: React.FC<{
  config: RegionStrategyConfigView;
  onEdit: (config: RegionStrategyConfigView) => void;
}> = ({ config, onEdit }) => {
  const { mutateAsync: reset, isPending } = useResetRegionStrategy();
  const label = REGION_LABELS[config.region];
  const profile = config.effectiveProfile;

  const handleReset = async () => {
    await reset(config.region);
    message.success(`${config.region} override 已重置`);
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <Badge status={config.hasOverride ? 'processing' : 'default'} />
          <Tag color={label.color}>{label.label}</Tag>
          <Text strong>{config.region}</Text>
          {config.hasOverride ? <Tag color="orange">override</Tag> : <Tag>default</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(config)}>
            编辑
          </Button>
          <Popconfirm
            title={`重置 ${config.region} override？`}
            okText="重置"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleReset}
            disabled={!config.hasOverride}
          >
            <Button
              size="small"
              danger
              disabled={!config.hasOverride}
              loading={isPending}
              icon={<UndoOutlined />}
            >
              重置
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label="Country">{profile.countryCode}</Descriptions.Item>
        <Descriptions.Item label="Locale">{profile.locale}</Descriptions.Item>
        <Descriptions.Item label="Timezone">{profile.timezone}</Descriptions.Item>
        <Descriptions.Item label="Storage">{profile.storageProvider}</Descriptions.Item>
        <Descriptions.Item label="Auth" span={2}>
          {renderTags(profile.authMethods)}
        </Descriptions.Item>
        <Descriptions.Item label="Billing" span={2}>
          {renderTags(profile.billingMethods)}
        </Descriptions.Item>
        <Descriptions.Item label="AI Providers" span={2}>
          {renderTags(profile.aiProviders)}
        </Descriptions.Item>
        <Descriptions.Item label="AI Models" span={2}>
          <Space direction="vertical" size={4}>
            <Text code>
              text: {profile.aiModelRouting.foodTextAnalysis.provider || '-'} /{' '}
              {profile.aiModelRouting.foodTextAnalysis.primaryModel}
            </Text>
            <Text code>
              vision: {profile.aiModelRouting.foodImageAnalysis.provider || '-'} /{' '}
              {profile.aiModelRouting.foodImageAnalysis.primaryModel}
              {profile.aiModelRouting.foodImageAnalysis.fallbackModel
                ? ` -> ${profile.aiModelRouting.foodImageAnalysis.fallbackModel}`
                : ''}
            </Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Push" span={2}>
          {renderTags(profile.pushProviders)}
        </Descriptions.Item>
        <Descriptions.Item label="SMS">
          {profile.smsProvider || <Text type="secondary">未配置</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Moderation">
          {profile.moderationProvider || <Text type="secondary">未配置</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="AI Features" span={2}>
          <Space wrap>
            {Object.entries(profile.aiFeatures).map(([key, enabled]) => (
              <Tag key={key} color={enabled ? 'green' : 'default'}>
                {key}: {enabled ? 'on' : 'off'}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Compliance" span={2}>
          <Space wrap>
            {Object.entries(profile.compliance).map(([key, enabled]) => (
              <Tag key={key} color={enabled ? 'red' : 'default'}>
                {key}: {enabled ? 'on' : 'off'}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>

      <Divider style={{ margin: '12px 0' }} />
      <Paragraph style={{ marginBottom: 0 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Override:
        </Text>
        <pre
          style={{
            marginTop: 6,
            marginBottom: 0,
            padding: 8,
            background: '#f6f8fa',
            borderRadius: 4,
            maxHeight: 160,
            overflow: 'auto',
            fontSize: 12,
          }}
        >
          {config.override ? JSON.stringify(config.override, null, 2) : 'null'}
        </pre>
      </Paragraph>
    </Card>
  );
};

const RegionStrategyPage: React.FC = () => {
  const [editing, setEditing] = useState<RegionStrategyConfigView | null>(null);
  const { data, isLoading, refetch, isFetching } = useRegionStrategies();

  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.region.localeCompare(b.region)),
    [data]
  );

  return (
    <>
      <Card
        size="small"
        title={
          <Space>
            <GlobalOutlined />
            <span>Region Strategy</span>
            <Tag color="blue">{sorted.length} regions</Tag>
          </Space>
        }
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={isFetching}
            onClick={() => refetch()}
          >
            刷新
          </Button>
        }
      >
        <Alert
          showIcon
          type="warning"
          icon={<CloudSyncOutlined />}
          message="Region override 会直接影响 /api/app/capabilities 的 effective profile，请先小范围验证再用于生产流量。"
          style={{ marginBottom: 16 }}
        />
        <Spin spinning={isLoading}>
          <Row gutter={[16, 16]}>
            {sorted.map((config) => (
              <Col key={config.region} xs={24} xl={12}>
                <RegionCard config={config} onEdit={setEditing} />
              </Col>
            ))}
          </Row>
        </Spin>
      </Card>

      <StrategyEditModal open={!!editing} config={editing} onClose={() => setEditing(null)} />
    </>
  );
};

export default RegionStrategyPage;
