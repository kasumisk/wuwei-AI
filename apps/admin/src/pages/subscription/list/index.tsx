import React, { useRef, useState } from 'react';
import {
  Card,
  Button,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  message,
  Tooltip,
  Avatar,
  Modal,
  Form,
  InputNumber,
  Select,
  Alert,
} from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  UserOutlined,
  CrownOutlined,
  DollarOutlined,
  ClockCircleOutlined,
  SwapOutlined,
  PlusCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  subscriptionApi,
  useSubscriptionOverview,
  useExtendSubscription,
  useChangeSubscriptionPlan,
  useSubscriptionPlans,
  type SubscriptionDto,
  type SubscriptionStatus,
  type SubscriptionTier,
  type PaymentChannel,
} from '@/services/subscriptionManagementService';

// ==================== 常量配置 ====================

const statusConfig: Record<SubscriptionStatus, { color: string; text: string }> = {
  trial: { color: 'cyan', text: '试用期' },
  active: { color: 'success', text: '生效中' },
  billing_retry: { color: 'orange', text: '重试扣费' },
  expired: { color: 'default', text: '已过期' },
  cancelled: { color: 'warning', text: '已取消' },
  canceled: { color: 'warning', text: '已取消' },
  grace_period: { color: 'processing', text: '宽限期' },
  paused: { color: 'default', text: '已暂停' },
  refunded: { color: 'magenta', text: '已退款' },
  revoked: { color: 'volcano', text: '已撤销' },
  transferred: { color: 'purple', text: '已转移' },
  unknown: { color: 'default', text: '未知' },
};

const tierConfig: Record<SubscriptionTier, { color: string; text: string }> = {
  free: { color: 'default', text: '免费' },
  pro: { color: 'blue', text: 'Pro' },
  premium: { color: 'gold', text: 'Premium' },
};

const channelConfig: Record<PaymentChannel, { text: string }> = {
  stripe: { text: 'Stripe' },
  apple_iap: { text: 'Apple IAP' },
  google_play: { text: 'Google Play' },
  wechat_pay: { text: '微信支付' },
  alipay: { text: '支付宝' },
  manual: { text: '人工操作' },
};

// ==================== 主组件 ====================

const SubscriptionList: React.FC = () => {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [riskFilter, setRiskFilter] = useState<string>('all');

  // 延期弹窗
  const [extendVisible, setExtendVisible] = useState(false);
  const [extendingRecord, setExtendingRecord] = useState<SubscriptionDto | null>(null);
  const [extendForm] = Form.useForm();

  // 换套餐弹窗
  const [changePlanVisible, setChangePlanVisible] = useState(false);
  const [changingRecord, setChangingRecord] = useState<SubscriptionDto | null>(null);
  const [changePlanForm] = Form.useForm();

  // 始终加载概览数据（不再需要toggle）
  const { data: overview, isLoading: overviewLoading } = useSubscriptionOverview();
  const { data: plansData } = useSubscriptionPlans();

  const extendMutation = useExtendSubscription({
    onSuccess: () => {
      message.success('延期成功');
      setExtendVisible(false);
      setExtendingRecord(null);
      extendForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`延期失败: ${err.message}`),
  });

  const changePlanMutation = useChangeSubscriptionPlan({
    onSuccess: () => {
      message.success('换套餐成功');
      setChangePlanVisible(false);
      setChangingRecord(null);
      changePlanForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`换套餐失败: ${err.message}`),
  });

  // ==================== 事件处理 ====================

  const handleExtend = (record: SubscriptionDto) => {
    setExtendingRecord(record);
    extendForm.setFieldsValue({ extendDays: 30 });
    setExtendVisible(true);
  };

  const handleExtendSubmit = async () => {
    const values = await extendForm.validateFields();
    if (!extendingRecord) return;
    extendMutation.mutate({
      id: extendingRecord.id,
      data: { extendDays: values.extendDays },
    });
  };

  const handleChangePlan = (record: SubscriptionDto) => {
    setChangingRecord(record);
    changePlanForm.setFieldsValue({ newPlanId: '' });
    setChangePlanVisible(true);
  };

  const handleChangePlanSubmit = async () => {
    const values = await changePlanForm.validateFields();
    if (!changingRecord) return;
    changePlanMutation.mutate({
      id: changingRecord.id,
      data: { newPlanId: values.newPlanId },
    });
  };

  // ==================== 表格列定义 ====================

  const columns: ProColumns<SubscriptionDto>[] = [
    {
      title: '用户',
      dataIndex: 'userId',
      width: 180,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space>
          <Avatar size={28} src={record.user?.avatar} icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: 500, lineHeight: 1.4, fontSize: 13 }}>
              {record.user?.nickname || record.user?.email || (
                <span style={{ color: '#bbb' }}>匿名</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              <Tooltip title={record.userId}>{record.userId.slice(0, 8)}...</Tooltip>
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '套餐',
      dataIndex: ['plan', 'tier'],
      width: 100,
      valueType: 'select',
      fieldProps: { fieldNames: undefined },
      valueEnum: {
        free: { text: '免费' },
        pro: { text: 'Pro' },
        premium: { text: 'Premium' },
      },
      render: (_: unknown, record: SubscriptionDto) => {
        const tier = record.plan?.tier || 'free';
        const cfg = tierConfig[tier] || tierConfig.free;
        return (
          <Tag color={cfg.color} icon={tier !== 'free' ? <CrownOutlined /> : undefined}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        active: { text: '生效中', status: 'Success' },
        trial: { text: '试用期', status: 'Processing' },
        billing_retry: { text: '重试扣费', status: 'Warning' },
        expired: { text: '已过期', status: 'Default' },
        cancelled: { text: '已取消', status: 'Warning' },
        canceled: { text: '已取消', status: 'Warning' },
        grace_period: { text: '宽限期', status: 'Processing' },
        paused: { text: '已暂停', status: 'Default' },
        refunded: { text: '已退款', status: 'Error' },
        revoked: { text: '已撤销', status: 'Error' },
        transferred: { text: '已转移', status: 'Default' },
        unknown: { text: '未知', status: 'Default' },
      },
      render: (_: unknown, record: SubscriptionDto) => {
        const cfg = statusConfig[record.status] ?? statusConfig.unknown;
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '支付渠道',
      dataIndex: 'paymentChannel',
      width: 120,
      valueType: 'select',
      valueEnum: {
        stripe: { text: 'Stripe' },
        apple_iap: { text: 'Apple IAP' },
        google_play: { text: 'Google Play' },
        wechat_pay: { text: '微信支付' },
        manual: { text: '人工操作' },
      },
      render: (_: unknown, record: SubscriptionDto) => {
        const cfg = channelConfig[record.paymentChannel];
        return cfg?.text || record.paymentChannel;
      },
    },
    {
      title: '商品ID',
      dataIndex: 'productId',
      width: 180,
      render: (_: unknown, record: SubscriptionDto) => (
        <Tooltip title={record.latestStoreProductId || '-'}>
          {record.latestStoreProductId
            ? `${record.latestStoreProductId.slice(0, 24)}${record.latestStoreProductId.length > 24 ? '...' : ''}`
            : '-'}
        </Tooltip>
      ),
    },
    {
      title: 'Offering/Package',
      key: 'mappedRevenueCat',
      width: 200,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontSize: 12 }}>
            {record.latestMappedOfferingId
              ? `offering=${record.latestMappedOfferingId}`
              : 'offering=-'}
          </span>
          <span style={{ fontSize: 12, color: '#666' }}>
            {record.latestMappedPackageId
              ? `package=${record.latestMappedPackageId}`
              : 'package=-'}
          </span>
        </Space>
      ),
    },
    {
      title: '平台订阅ID',
      dataIndex: 'platformSubscriptionId',
      width: 180,
      render: (_: unknown, record: SubscriptionDto) => (
        <Tooltip title={record.platformSubscriptionId || '-'}>
          {record.platformSubscriptionId
            ? `${record.platformSubscriptionId.slice(0, 20)}${record.platformSubscriptionId.length > 20 ? '...' : ''}`
            : '-'}
        </Tooltip>
      ),
    },
    {
      title: '自动续费',
      dataIndex: 'autoRenew',
      width: 90,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Tag color={record.autoRenew ? 'green' : 'default'}>{record.autoRenew ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '开始时间',
      dataIndex: 'startsAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '到期时间',
      dataIndex: 'expiresAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
      render: (_: unknown, record: SubscriptionDto) => {
        const isExpired = new Date(record.expiresAt) < new Date();
        return (
          <span style={{ color: isExpired ? '#ff4d4f' : undefined }}>
            {new Date(record.expiresAt).toLocaleString('zh-CN')}
          </span>
        );
      },
    },
    {
      title: '最近同步',
      dataIndex: 'lastSyncedAt',
      width: 180,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => {
        const color =
          record.lastSyncStatus === 'failed'
            ? 'error'
            : record.lastSyncStatus === 'ok'
              ? 'success'
              : 'default';
        return (
          <Space direction="vertical" size={2}>
            <Tag color={color}>{record.lastSyncStatus || 'unknown'}</Tag>
            <span style={{ fontSize: 12, color: '#666' }}>
              {record.lastSyncedAt
                ? new Date(record.lastSyncedAt).toLocaleString('zh-CN')
                : '-'}
            </span>
          </Space>
        );
      },
    },
    {
      title: '同步来源',
      dataIndex: 'lastSyncSource',
      width: 110,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => record.lastSyncSource || '-',
    },
    {
      title: 'Webhook',
      dataIndex: 'lastWebhookStatus',
      width: 130,
      search: false,
      render: (_: unknown, record: SubscriptionDto) =>
        record.lastWebhookStatus ? (
          <Tooltip title={record.lastWebhookError || undefined}>
            <Tag color={record.lastWebhookStatus === 'failed' ? 'error' : 'default'}>
              {record.lastWebhookStatus}
            </Tag>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: '最近交易',
      key: 'latestTransaction',
      width: 180,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontSize: 12 }}>{record.latestTransactionType || '-'}</span>
          <span style={{ fontSize: 12, color: '#666' }}>
            {record.latestTransactionAt
              ? new Date(record.latestTransactionAt).toLocaleString('zh-CN')
              : '-'}
          </span>
        </Space>
      ),
    },
    {
      title: '最近 Webhook',
      key: 'latestWebhook',
      width: 180,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontSize: 12 }}>{record.latestWebhookEventType || '-'}</span>
          <span style={{ fontSize: 12, color: '#666' }}>
            {record.latestWebhookAt
              ? new Date(record.latestWebhookAt).toLocaleString('zh-CN')
              : '-'}
          </span>
        </Space>
      ),
    },
    {
      title: '风险标记',
      key: 'riskFlags',
      width: 220,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space size={4} wrap>
          {record.hasRefundRecord && <Tag color="magenta">已退款</Tag>}
          {record.hasManualEntitlement && <Tag color="gold">手动权益</Tag>}
          {record.hasRevenueCatSignal === false && <Tag color="error">无 RC 信号</Tag>}
          {record.lastWebhookStatus === 'failed' && <Tag color="error">Webhook Failed</Tag>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/subscription/detail/${record.id}`)}
          >
            详情
          </Button>
          {['active', 'trial', 'grace_period', 'billing_retry'].includes(record.status) && (
            <>
              <Button
                type="link"
                size="small"
                icon={<PlusCircleOutlined />}
                style={{ color: '#52c41a' }}
                onClick={() => handleExtend(record)}
              >
                延期
              </Button>
              <Button
                type="link"
                size="small"
                icon={<SwapOutlined />}
                style={{ color: '#1677ff' }}
                onClick={() => handleChangePlan(record)}
              >
                换套餐
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  // ==================== 渲染 ====================

  const planOptions = (plansData as any)?.list
    ? (plansData as any).list
        .filter((p: any) => p.isActive)
        .map((p: any) => ({
          label: `${tierConfig[p.tier as SubscriptionTier]?.text || p.tier} - ${p.billingCycle === 'monthly' ? '月付' : p.billingCycle === 'quarterly' ? '季付' : p.billingCycle === 'yearly' ? '年付' : '终身'} ($${(p.priceCents / 100).toFixed(2)})`,
          value: p.id,
        }))
    : [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 概览统计卡片（常驻） */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Statistic
              title="总订阅数"
              value={overview?.totalSubscriptions ?? '-'}
              prefix={<CrownOutlined style={{ color: '#722ed1' }} />}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Statistic
              title="活跃订阅"
              value={overview?.activeSubscriptions ?? '-'}
              prefix={<ClockCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Statistic
              title="Pro 用户"
              value={overview?.byTier?.pro ?? '-'}
              prefix={<CrownOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: '#1677ff', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Statistic
              title="Premium 用户"
              value={overview?.byTier?.premium ?? '-'}
              prefix={<CrownOutlined style={{ color: '#d48806' }} />}
              valueStyle={{ color: '#d48806', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Statistic
              title="MRR"
              value={overview ? `$${(overview.mrr / 100).toFixed(0)}` : '-'}
              prefix={<DollarOutlined style={{ color: '#13c2c2' }} />}
              valueStyle={{ color: '#13c2c2', fontSize: 22 }}
            />
          </Card>
        </Col>
        {/* <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Tooltip title="按支付渠道统计">
              <Statistic
                title="渠道数"
                value={overview ? Object.keys(overview.byChannel).length : '-'}
                valueStyle={{ fontSize: 22 }}
              />
            </Tooltip>
          </Card>
        </Col> */}
      </Row>

      {/* 渠道分布标签 */}
      {/* {overview && Object.keys(overview.byChannel).length > 0 && (
        <Card size="small" title="支付渠道分布" style={{ marginBottom: 16 }}>
          <Space wrap>
            {Object.entries(overview.byChannel).map(([channel, count]) => (
              <Tag key={channel} style={{ padding: '4px 12px', fontSize: 13 }}>
                {channelConfig[channel as PaymentChannel]?.text || channel}:{' '}
                <strong>{count as number}</strong>
              </Tag>
            ))}
          </Space>
        </Card>
      )} */}

      {/* 表格 */}
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="列表已聚合最近交易、最近 Webhook、退款记录、手动权益和 RevenueCat 信号，用于快速排障。"
        />
        <ProTable<SubscriptionDto>
          actionRef={actionRef}
          rowKey="id"
          headerTitle="订阅用户管理"
          columns={columns}
          scroll={{ x: 2100 }}
          request={async (params) => {
            try {
              const { list, total } = await subscriptionApi.getSubscriptions({
                page: params.current,
                pageSize: params.pageSize,
                status: params.status || undefined,
                tier: params['plan,tier'] || params.tier || undefined,
              paymentChannel: params.paymentChannel || undefined,
              keyword: params.userId || undefined,
              platformSubscriptionId: params.platformSubscriptionId || undefined,
              productId: params.productId || undefined,
              hasRefundRecord: riskFilter === 'has_refund' ? true : undefined,
              hasManualEntitlement:
                riskFilter === 'manual_entitlement' ? true : undefined,
              hasRevenueCatSignal:
                riskFilter === 'no_rc_signal'
                  ? false
                  : riskFilter === 'has_rc_signal'
                    ? true
                    : undefined,
              webhookProcessingStatus:
                riskFilter === 'webhook_failed' ? 'failed' : undefined,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
          toolBarRender={() => [
            <Select
              key="risk-filter"
              value={riskFilter}
              style={{ width: 220 }}
              onChange={(value) => {
                setRiskFilter(value);
                actionRef.current?.reload();
              }}
              options={[
                { label: '全部订阅', value: 'all' },
                { label: 'Webhook Failed', value: 'webhook_failed' },
                { label: '无 RC 信号', value: 'no_rc_signal' },
                { label: '有 RC 信号', value: 'has_rc_signal' },
                { label: '已退款', value: 'has_refund' },
                { label: '手动权益', value: 'manual_entitlement' },
              ]}
            />,
            <Button
              key="anomalies"
              icon={<WarningOutlined />}
              onClick={() => navigate('/subscription/anomalies')}
            >
              异常看板
            </Button>,
            <Button
              key="refresh"
              icon={<ReloadOutlined />}
              onClick={() => actionRef.current?.reload()}
            >
              刷新
            </Button>,
          ]}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            showTotal: (total: number) => `共 ${total} 条订阅`,
          }}
          search={{ labelWidth: 'auto' }}
        />
      </Card>

      {/* 延期弹窗 */}
      <Modal
        title={`延期订阅 - ${extendingRecord?.user?.nickname || extendingRecord?.user?.email || ''}`}
        open={extendVisible}
        onOk={handleExtendSubmit}
        confirmLoading={extendMutation.isPending}
        onCancel={() => {
          setExtendVisible(false);
          setExtendingRecord(null);
          extendForm.resetFields();
        }}
        width={480}
      >
        <Form form={extendForm} layout="vertical">
          <Form.Item
            label="延期天数"
            name="extendDays"
            rules={[{ required: true, message: '请输入延期天数' }]}
          >
            <InputNumber
              min={1}
              max={365}
              style={{ width: '100%' }}
              placeholder="输入延期天数"
              addonAfter="天"
            />
          </Form.Item>
        </Form>
        {extendingRecord && (
          <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
            <div>
              当前套餐: <Tag>{tierConfig[extendingRecord.plan?.tier || 'free']?.text}</Tag>
            </div>
            <div style={{ marginTop: 4 }}>
              当前到期: {new Date(extendingRecord.expiresAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        )}
      </Modal>

      {/* 换套餐弹窗 */}
      <Modal
        title={`换套餐 - ${changingRecord?.user?.nickname || changingRecord?.user?.email || ''}`}
        open={changePlanVisible}
        onOk={handleChangePlanSubmit}
        confirmLoading={changePlanMutation.isPending}
        onCancel={() => {
          setChangePlanVisible(false);
          setChangingRecord(null);
          changePlanForm.resetFields();
        }}
        width={480}
      >
        <Form form={changePlanForm} layout="vertical">
          <Form.Item
            label="新套餐"
            name="newPlanId"
            rules={[{ required: true, message: '请选择新套餐' }]}
          >
            <Select
              placeholder="选择新套餐"
              options={planOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
        {changingRecord && (
          <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
            <div>
              当前套餐: <Tag>{tierConfig[changingRecord.plan?.tier || 'free']?.text}</Tag>
            </div>
            <div style={{ marginTop: 4 }}>
              支付渠道:{' '}
              {channelConfig[changingRecord.paymentChannel]?.text || changingRecord.paymentChannel}
            </div>
          </div>
        )}
      </Modal>
    </Space>
  );
};

export default SubscriptionList;

export const routeConfig = {
  name: 'subscription-list',
  title: '订阅用户',
  icon: 'TeamOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};
