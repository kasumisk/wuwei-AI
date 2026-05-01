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
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Alert,
  Timeline,
  Table,
  DatePicker,
} from 'antd';
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  SwapOutlined,
  CrownOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useSubscriptionDetail,
  useSubscriptionTimeline,
  useExtendSubscription,
  useChangeSubscriptionPlan,
  useResyncSubscription,
  useRefundSubscription,
  useRevokeSubscription,
  useGrantManualEntitlement,
  useRevokeManualEntitlement,
  useSubscriptionPlans,
  type SubscriptionStatus,
  type SubscriptionTier,
  type PaymentChannel,
} from '@/services/subscriptionManagementService';

// ==================== 常量 ====================

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

const channelLabels: Record<PaymentChannel, string> = {
  stripe: 'Stripe',
  apple_iap: 'Apple IAP',
  google_play: 'Google Play',
  wechat_pay: '微信支付',
  alipay: '支付宝',
  manual: '人工操作',
};

// ==================== 主组件 ====================

const SubscriptionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [extendVisible, setExtendVisible] = useState(false);
  const [changePlanVisible, setChangePlanVisible] = useState(false);
  const [refundVisible, setRefundVisible] = useState(false);
  const [revokeVisible, setRevokeVisible] = useState(false);
  const [grantVisible, setGrantVisible] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'audit' | 'transaction' | 'webhook'>('all');
  const [extendForm] = Form.useForm();
  const [changePlanForm] = Form.useForm();
  const [refundForm] = Form.useForm();
  const [revokeForm] = Form.useForm();
  const [grantForm] = Form.useForm();

  const { data: subscription, isLoading } = useSubscriptionDetail(id!, !!id);
  const { data: timeline, isLoading: timelineLoading } = useSubscriptionTimeline(
    id!,
    { limit: 50 },
    !!id
  );
  const { data: plans } = useSubscriptionPlans({ enabled: changePlanVisible });

  const extendMutation = useExtendSubscription({
    onSuccess: () => {
      message.success('延期成功');
      setExtendVisible(false);
      extendForm.resetFields();
    },
    onError: (err: any) => message.error(`延期失败: ${err.message}`),
  });

  const changePlanMutation = useChangeSubscriptionPlan({
    onSuccess: () => {
      message.success('变更套餐成功');
      setChangePlanVisible(false);
      changePlanForm.resetFields();
    },
    onError: (err: any) => message.error(`变更失败: ${err.message}`),
  });

  const resyncMutation = useResyncSubscription({
    onSuccess: (result) =>
      message.success(
        result.mode === 'queued'
          ? `已提交后台重同步，jobId=${result.jobId || '-'}`
          : '已同步完成重同步',
      ),
    onError: (err: any) => message.error(`重同步失败: ${err.message}`),
  });
  const refundMutation = useRefundSubscription({
    onSuccess: () => {
      message.success('订阅已标记退款');
      setRefundVisible(false);
      refundForm.resetFields();
    },
    onError: (err: any) => message.error(`退款失败: ${err.message}`),
  });
  const revokeMutation = useRevokeSubscription({
    onSuccess: () => {
      message.success('订阅访问已撤销');
      setRevokeVisible(false);
      revokeForm.resetFields();
    },
    onError: (err: any) => message.error(`撤销失败: ${err.message}`),
  });
  const grantMutation = useGrantManualEntitlement({
    onSuccess: () => {
      message.success('已授予手动权益');
      setGrantVisible(false);
      grantForm.resetFields();
    },
    onError: (err: any) => message.error(`授予失败: ${err.message}`),
  });
  const revokeEntitlementMutation = useRevokeManualEntitlement({
    onSuccess: () => message.success('已撤销手动权益'),
    onError: (err: any) => message.error(`撤销失败: ${err.message}`),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <Typography.Text type="danger">未找到订阅记录</Typography.Text>
        <br />
        <Button onClick={() => navigate('/subscription/list')} style={{ marginTop: 16 }}>
          返回列表
        </Button>
      </Card>
    );
  }

  const sCfg = statusConfig[subscription.status] ?? statusConfig.unknown;
  const tCfg = tierConfig[subscription.plan?.tier || 'free'];
  const isExpired = new Date(subscription.expiresAt) < new Date();
  const latestTransaction = timeline?.transactions[0];
  const latestWebhook = timeline?.webhookEvents[0];
  const activeManualEntitlements =
    subscription.userEntitlements?.filter(
      (item) => item.sourceType === 'manual' && item.status === 'active'
    ) ?? [];
  const providerCustomerSummary =
    subscription.providerCustomers?.map((item) => `${item.provider}:${item.providerCustomerId}`).join(', ') ||
    '-';
  const timelineItems = timeline
    ? [
        ...timeline.audits.map((item) => ({
          at: item.createdAt,
          color: 'blue',
          node: (
            <div>
              <Typography.Text strong>[Audit] {item.action}</Typography.Text>
              <div>{item.reason || '-'}</div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#1677ff' }}>
                  查看 before/after
                </summary>
                <pre
                  style={{
                    background: '#f7f7f7',
                    padding: 12,
                    borderRadius: 6,
                    marginTop: 8,
                    fontSize: 12,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(
                    {
                      beforeState: item.beforeState,
                      afterState: item.afterState,
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
              <Typography.Text type="secondary">
                {new Date(item.createdAt).toLocaleString('zh-CN')}
              </Typography.Text>
            </div>
          ),
        })),
        ...timeline.transactions.map((item) => ({
          at: item.createdAt,
          color: 'green',
          node: (
            <div>
              <Typography.Text strong>[Txn] {item.transactionType}</Typography.Text>
              <div>
                {item.provider} / {item.store || '-'} / {item.environment || '-'} /{' '}
                {item.status}
              </div>
              <div>
                商品: {item.storeProductId || '-'}
                {item.mappedOfferingId ? ` / offering=${item.mappedOfferingId}` : ''}
                {item.mappedPackageId ? ` / package=${item.mappedPackageId}` : ''}
              </div>
              <div>
                交易: {item.transactionId ? <Typography.Text copyable={{ text: item.transactionId }}>{item.transactionId}</Typography.Text> : '-'} / 原始链:{' '}
                {item.originalTransactionId ? (
                  <Typography.Text copyable={{ text: item.originalTransactionId }}>
                    {item.originalTransactionId}
                  </Typography.Text>
                ) : (
                  '-'
                )}
              </div>
              <div>
                Purchase Token:{' '}
                {item.purchaseToken ? (
                  <Typography.Text copyable={{ text: item.purchaseToken }}>
                    {item.purchaseToken}
                  </Typography.Text>
                ) : (
                  '-'
                )}
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#1677ff' }}>
                  查看快照
                </summary>
                <pre
                  style={{
                    background: '#f7f7f7',
                    padding: 12,
                    borderRadius: 6,
                    marginTop: 8,
                    fontSize: 12,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(item.rawSnapshot, null, 2)}
                </pre>
              </details>
              <Typography.Text type="secondary">
                {new Date(item.createdAt).toLocaleString('zh-CN')}
              </Typography.Text>
            </div>
          ),
        })),
        ...timeline.webhookEvents.map((item) => ({
          at: item.receivedAt,
          color: item.processingStatus === 'failed' ? 'red' : 'gray',
          node: (
            <div>
              <Typography.Text strong>[Webhook] {item.eventType || 'unknown'}</Typography.Text>
              <div>
                {item.providerEventId ? (
                  <Typography.Text copyable={{ text: item.providerEventId }}>
                    {item.providerEventId}
                  </Typography.Text>
                ) : (
                  '-'
                )}{' '}
                / {item.processingStatus} / {item.environment || '-'}
              </div>
              <div>
                商品: {item.productId || '-'}
                {item.mappedOfferingId ? ` / offering=${item.mappedOfferingId}` : ''}
                {item.mappedPackageId ? ` / package=${item.mappedPackageId}` : ''}
              </div>
              <div>
                交易: {item.transactionId ? <Typography.Text copyable={{ text: item.transactionId }}>{item.transactionId}</Typography.Text> : '-'} / 原始链:{' '}
                {item.originalTransactionId ? (
                  <Typography.Text copyable={{ text: item.originalTransactionId }}>
                    {item.originalTransactionId}
                  </Typography.Text>
                ) : (
                  '-'
                )}
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#1677ff' }}>
                  查看 payload
                </summary>
                <pre
                  style={{
                    background: '#f7f7f7',
                    padding: 12,
                    borderRadius: 6,
                    marginTop: 8,
                    fontSize: 12,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(item.rawPayload, null, 2)}
                </pre>
              </details>
              <Typography.Text type="secondary">
                {new Date(item.receivedAt).toLocaleString('zh-CN')}
              </Typography.Text>
            </div>
          ),
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    : [];
  const filteredTimelineItems = timelineItems.filter((item) => {
    if (timelineFilter === 'all') return true;
    if (timelineFilter === 'audit') return item.color === 'blue';
    if (timelineFilter === 'transaction') return item.color === 'green';
    if (timelineFilter === 'webhook') return item.color === 'gray' || item.color === 'red';
    return true;
  });
  const renderCopyable = (value?: string | null) =>
    value ? <Typography.Text copyable={{ text: value }}>{value}</Typography.Text> : '-';

  return (
    <div>
      {/* 头部 */}
      <Card style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/subscription/list')}>
              返回列表
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              订阅详情
            </Typography.Title>
          </Space>
          <Space>
            <Button
              icon={<SyncOutlined />}
              loading={resyncMutation.isPending}
              onClick={() =>
                resyncMutation.mutate({
                  id: id!,
                  data: { reason: 'Admin manual test resync' },
                })
              }
            >
              重同步
            </Button>
            <Button
              danger
              onClick={() => setRefundVisible(true)}
              disabled={['refunded', 'revoked'].includes(subscription.status)}
            >
              退款
            </Button>
            <Button
              danger
              onClick={() => setRevokeVisible(true)}
              disabled={subscription.status === 'revoked'}
            >
              撤销访问
            </Button>
            <Button onClick={() => setGrantVisible(true)}>手动权益</Button>
            <Button
              icon={<ClockCircleOutlined />}
              onClick={() => setExtendVisible(true)}
              disabled={
                !['active', 'trial', 'grace_period', 'billing_retry'].includes(
                  subscription.status
                )
              }
            >
              延期
            </Button>
            <Button
              icon={<SwapOutlined />}
              onClick={() => setChangePlanVisible(true)}
              disabled={
                !['active', 'trial', 'grace_period', 'billing_retry'].includes(
                  subscription.status
                )
              }
            >
              变更套餐
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 订阅信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Alert
          type={
            subscription.status === 'refunded' || subscription.status === 'revoked'
              ? 'warning'
              : latestWebhook?.processingStatus === 'failed'
                ? 'error'
                : 'info'
          }
          showIcon
          style={{ marginBottom: 16 }}
          message="当前状态摘要"
          description={
            <Space direction="vertical" size={2}>
              <span>
                当前订阅状态为 {sCfg.text}，权益来源以后端聚合快照为准。
                {subscription.autoRenew ? ' 仍处于自动续费链路。' : ' 当前已不自动续费。'}
              </span>
              <span>
                最近 provider 信号：
                {latestWebhook
                  ? `${latestWebhook.eventType || 'unknown'} @ ${new Date(
                      latestWebhook.receivedAt
                    ).toLocaleString('zh-CN')}`
                  : '无 webhook 记录'}
                ；最近交易：
                {latestTransaction
                  ? `${latestTransaction.transactionType} @ ${new Date(
                      latestTransaction.createdAt
                    ).toLocaleString('zh-CN')}`
                  : '无交易记录'}
              </span>
              <span>
                手动权益 {activeManualEntitlements.length} 条；Provider Customer: {providerCustomerSummary}
              </span>
            </Space>
          }
        />
        <Tabs
          defaultActiveKey="info"
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="订阅ID">
                    {renderCopyable(subscription.id)}
                  </Descriptions.Item>
                  <Descriptions.Item label="用户">
                    {subscription.user?.nickname || subscription.user?.email || '匿名'} (
                    {subscription.userId.slice(0, 8)}...)
                  </Descriptions.Item>
                  <Descriptions.Item label="用户ID">{renderCopyable(subscription.userId)}</Descriptions.Item>
                  <Descriptions.Item label="套餐">
                    <Tag color={tCfg.color} icon={<CrownOutlined />}>
                      {tCfg.text}
                    </Tag>
                    {subscription.plan && (
                      <span style={{ marginLeft: 8, color: '#666' }}>
                        ${(subscription.plan.priceCents / 100).toFixed(2)}/
                        {subscription.plan.billingCycle === 'monthly'
                          ? '月'
                          : subscription.plan.billingCycle === 'yearly'
                            ? '年'
                            : '终身'}
                      </span>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={sCfg.color}>{sCfg.text}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="支付渠道">
                    {channelLabels[subscription.paymentChannel] || subscription.paymentChannel}
                  </Descriptions.Item>
                  <Descriptions.Item label="平台订阅ID">
                    {renderCopyable(subscription.platformSubscriptionId)}
                  </Descriptions.Item>
                  <Descriptions.Item label="自动续费">
                    <Tag color={subscription.autoRenew ? 'green' : 'default'}>
                      {subscription.autoRenew ? '是' : '否'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="开始时间">
                    {new Date(subscription.startsAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                  <Descriptions.Item label="到期时间">
                    <span style={{ color: isExpired ? '#ff4d4f' : undefined }}>
                      {new Date(subscription.expiresAt).toLocaleString('zh-CN')}
                    </span>
                    {isExpired && (
                      <Tag color="error" style={{ marginLeft: 8 }}>
                        已过期
                      </Tag>
                    )}
                  </Descriptions.Item>
                  {(subscription.canceledAt || subscription.cancelledAt) && (
                    <Descriptions.Item label="取消时间" span={2}>
                      {new Date(
                        subscription.canceledAt || subscription.cancelledAt!
                      ).toLocaleString('zh-CN')}
                    </Descriptions.Item>
                  )}
                  {subscription.plan && (
                    <Descriptions.Item label="商品映射" span={2}>
                      <Space direction="vertical" size={2}>
                        {(subscription.plan.storeProducts ?? []).length > 0 ? (
                          subscription.plan.storeProducts?.map((item) => (
                            <Typography.Text key={item.id}>
                              {item.provider} / {item.store} / {item.environment}:{' '}
                              {item.productId}
                              {item.offeringId ? ` / offering=${item.offeringId}` : ''}
                              {item.packageId ? ` / package=${item.packageId}` : ''}
                            </Typography.Text>
                          ))
                        ) : (
                          <Typography.Text>-</Typography.Text>
                        )}
                      </Space>
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="创建时间">
                    {new Date(subscription.createdAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">
                    {new Date(subscription.updatedAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'entitlements',
              label: `当前权益 (${subscription.userEntitlements?.length || 0})`,
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  {subscription.providerCustomers?.length ? (
                    <Card size="small" title="Provider Customer">
                      <Table
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={subscription.providerCustomers}
                        columns={[
                          { title: 'Provider', dataIndex: 'provider', width: 120 },
                          { title: '环境', dataIndex: 'environment', width: 100 },
                          {
                            title: 'Customer ID',
                            dataIndex: 'providerCustomerId',
                            ellipsis: true,
                            render: (value?: string | null) => renderCopyable(value),
                          },
                          { title: '状态', dataIndex: 'status', width: 100 },
                          {
                            title: '最近同步',
                            dataIndex: 'lastSyncedAt',
                            width: 180,
                            render: (value?: string | null) =>
                              value ? new Date(value).toLocaleString('zh-CN') : '-',
                          },
                        ]}
                      />
                    </Card>
                  ) : null}

                  {subscription.userEntitlements?.length ? (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={{ pageSize: 20 }}
                      dataSource={subscription.userEntitlements}
                      columns={[
                        {
                          title: '权益',
                          dataIndex: 'entitlementCode',
                          width: 220,
                        },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          width: 100,
                          render: (value: string) => (
                            <Tag color={value === 'active' ? 'success' : 'default'}>{value}</Tag>
                          ),
                        },
                        {
                          title: '来源',
                          dataIndex: 'sourceType',
                          width: 130,
                        },
                        {
                          title: 'Provider',
                          dataIndex: 'provider',
                          width: 120,
                          render: (value?: string | null) => value || '-',
                        },
                        {
                          title: '有效期',
                          key: 'effectiveRange',
                          width: 300,
                          render: (_: unknown, record: any) => (
                            <span>
                              {new Date(record.effectiveFrom).toLocaleString('zh-CN')} 至{' '}
                              {record.effectiveTo
                                ? new Date(record.effectiveTo).toLocaleString('zh-CN')
                                : '长期'}
                            </span>
                          ),
                        },
                        {
                          title: '值',
                          dataIndex: 'value',
                          render: (value: unknown) => (
                            <Typography.Text code style={{ whiteSpace: 'normal' }}>
                              {JSON.stringify(value)}
                            </Typography.Text>
                          ),
                        },
                        {
                          title: '操作',
                          width: 90,
                          render: (_: unknown, record: any) =>
                            record.sourceType === 'manual' &&
                            record.status === 'active' ? (
                              <Button
                                type="link"
                                danger
                                size="small"
                                loading={revokeEntitlementMutation.isPending}
                                onClick={() =>
                                  revokeEntitlementMutation.mutate({
                                    id: id!,
                                    data: {
                                      userEntitlementId: record.id,
                                      reason: 'Admin revoked manual entitlement',
                                    },
                                  })
                                }
                              >
                                撤销
                              </Button>
                            ) : (
                              '-'
                            ),
                        },
                      ]}
                    />
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="暂无用户权益聚合数据"
                      description="可点击重同步从 provider 快照重新收敛，或检查该订阅是否已过期/退款。"
                    />
                  )}

                  {subscription.plan?.entitlements ? (
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#1677ff' }}>
                        查看套餐默认权益 JSON
                      </summary>
                      <pre
                        style={{
                          background: '#f5f5f5',
                          padding: 16,
                          borderRadius: 8,
                          fontSize: 12,
                          maxHeight: 400,
                          overflow: 'auto',
                          marginTop: 12,
                        }}
                      >
                        {JSON.stringify(subscription.plan.entitlements, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </Space>
              ),
            },
            {
              key: 'payments',
              label: `支付记录 (${subscription.paymentRecords?.length || 0})`,
              children: subscription.paymentRecords?.length ? (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                    dataSource={subscription.paymentRecords}
                    columns={[
                    {
                      title: '订单号',
                      dataIndex: 'orderNo',
                      width: 180,
                      render: (value: string) => renderCopyable(value),
                    },
                    {
                      title: '渠道',
                      dataIndex: 'channel',
                      width: 120,
                      render: (value: PaymentChannel) => channelLabels[value] || value,
                    },
                    {
                      title: '金额',
                      dataIndex: 'amountCents',
                      width: 120,
                      render: (value: number, record: any) =>
                        `${record.currency || 'CNY'} ${(value / 100).toFixed(2)}`,
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (value: string) => <Tag>{value}</Tag>,
                    },
                    {
                      title: '交易号',
                      dataIndex: 'transactionId',
                      width: 180,
                      ellipsis: true,
                      render: (value?: string | null) => renderCopyable(value),
                    },
                    {
                      title: '平台流水号',
                      dataIndex: 'platformTransactionId',
                      ellipsis: true,
                      render: (value?: string | null) => renderCopyable(value),
                    },
                    {
                      title: '支付时间',
                      dataIndex: 'paidAt',
                      width: 180,
                      render: (value?: string | null) =>
                        value ? new Date(value).toLocaleString('zh-CN') : '-',
                    },
                    {
                      title: '退款',
                      key: 'refund',
                      width: 180,
                      render: (_: unknown, record: any) =>
                        record.refundedAt
                          ? `${record.currency || 'CNY'} ${(
                              (record.refundAmountCents || 0) / 100
                            ).toFixed(2)} / ${new Date(record.refundedAt).toLocaleString(
                              'zh-CN'
                            )}`
                          : '-',
                    },
                  ]}
                />
              ) : (
                <Typography.Text type="secondary">暂无支付记录</Typography.Text>
              ),
            },
            {
              key: 'quotas',
              label: `用量配额 (${subscription.usageQuotas?.length || 0})`,
              children: subscription.usageQuotas?.length ? (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={subscription.usageQuotas}
                  columns={[
                    {
                      title: '功能',
                      dataIndex: 'feature',
                    },
                    {
                      title: '已用',
                      dataIndex: 'used',
                      width: 100,
                    },
                    {
                      title: '额度',
                      dataIndex: 'quotaLimit',
                      width: 100,
                      render: (value: number) => (value === 0 ? '无限制' : value),
                    },
                    {
                      title: '周期',
                      dataIndex: 'cycle',
                      width: 100,
                    },
                    {
                      title: '重置时间',
                      dataIndex: 'resetAt',
                      width: 180,
                      render: (value?: string | null) =>
                        value ? new Date(value).toLocaleString('zh-CN') : '-',
                    },
                  ]}
                />
              ) : (
                <Typography.Text type="secondary">暂无用量配额数据</Typography.Text>
              ),
            },
            {
              key: 'timeline',
              label: '时间线',
              children: timelineLoading ? (
                <Spin />
              ) : timeline ? (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert
                    type="info"
                    showIcon
                    message={`审计 ${timeline.audits.length} 条，交易 ${timeline.transactions.length} 条，Webhook ${timeline.webhookEvents.length} 条`}
                  />
                  <Select
                    value={timelineFilter}
                    style={{ width: 180 }}
                    onChange={(value) => setTimelineFilter(value)}
                    options={[
                      { label: '全部时间线', value: 'all' },
                      { label: '只看 Audit', value: 'audit' },
                      { label: '只看 Transaction', value: 'transaction' },
                      { label: '只看 Webhook', value: 'webhook' },
                    ]}
                  />
                  <Timeline
                    items={filteredTimelineItems.map((item) => ({
                      color: item.color,
                      children: item.node,
                    }))}
                  />
                </Space>
              ) : (
                <Typography.Text type="secondary">暂无时间线数据</Typography.Text>
              ),
            },
          ]}
        />
      </Card>

      {/* 延期弹窗 */}
      <Modal
        title="标记退款"
        open={refundVisible}
        onOk={() => {
          refundForm.validateFields().then((values) => {
            refundMutation.mutate({ id: id!, data: values });
          });
        }}
        confirmLoading={refundMutation.isPending}
        onCancel={() => {
          setRefundVisible(false);
          refundForm.resetFields();
        }}
      >
        <Form form={refundForm} layout="vertical">
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="退款会立即撤销本地权益，并将关联支付记录标记为 refunded。"
          />
          <Form.Item name="reason" label="原因说明" initialValue="Admin manual refund">
            <Select
              options={[
                { label: 'Admin manual refund', value: 'Admin manual refund' },
                { label: 'Chargeback / dispute', value: 'Chargeback / dispute' },
                { label: 'Customer support adjustment', value: 'Customer support adjustment' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="撤销访问权限"
        open={revokeVisible}
        onOk={() => {
          revokeForm.validateFields().then((values) => {
            revokeMutation.mutate({ id: id!, data: values });
          });
        }}
        confirmLoading={revokeMutation.isPending}
        onCancel={() => {
          setRevokeVisible(false);
          revokeForm.resetFields();
        }}
      >
        <Form form={revokeForm} layout="vertical">
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="撤销会立刻关闭访问权限，但不会把支付记录改成 refunded。"
          />
          <Form.Item name="reason" label="原因说明" initialValue="Admin manual revoke">
            <Select
              options={[
                { label: 'Admin manual revoke', value: 'Admin manual revoke' },
                { label: 'Fraud / abuse detected', value: 'Fraud / abuse detected' },
                { label: 'Account transfer / policy violation', value: 'Account transfer / policy violation' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="手动授予权益"
        open={grantVisible}
        onOk={() => {
          grantForm.validateFields().then((values) => {
            const rawValue = values.value?.trim();
            let parsed: unknown = {};
            try {
              if (rawValue) {
                parsed = JSON.parse(rawValue);
              }
            } catch {
              message.error('权益值必须是合法 JSON');
              return;
            }
            grantMutation.mutate({
              id: id!,
              data: {
                entitlementCode: values.entitlementCode,
                value: parsed,
                effectiveTo: values.effectiveTo?.toISOString?.() || undefined,
                reason: values.reason || undefined,
              },
            });
          });
        }}
        confirmLoading={grantMutation.isPending}
        onCancel={() => {
          setGrantVisible(false);
          grantForm.resetFields();
        }}
      >
        <Form form={grantForm} layout="vertical">
          <Form.Item
            name="entitlementCode"
            label="权益编码"
            rules={[{ required: true, message: '请输入权益编码' }]}
          >
            <Select
              showSearch
              options={[
                { label: 'priority_ai', value: 'priority_ai' },
                { label: 'advanced_nutrition_report', value: 'advanced_nutrition_report' },
                { label: 'family_plan', value: 'family_plan' },
                { label: 'export_history', value: 'export_history' },
                { label: 'analysis_history', value: 'analysis_history' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="value"
            label="权益值 JSON"
            initialValue="true"
            rules={[{ required: true, message: '请输入 JSON 值' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="effectiveTo" label="失效时间">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="原因说明" initialValue="Admin manual entitlement grant">
            <Select
              options={[
                { label: 'Admin manual entitlement grant', value: 'Admin manual entitlement grant' },
                { label: 'Compensation / goodwill', value: 'Compensation / goodwill' },
                { label: 'Internal test access', value: 'Internal test access' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="延长订阅"
        open={extendVisible}
        onOk={() => {
          extendForm.validateFields().then((values) => {
            extendMutation.mutate({ id: id!, data: values });
          });
        }}
        confirmLoading={extendMutation.isPending}
        onCancel={() => {
          setExtendVisible(false);
          extendForm.resetFields();
        }}
        width={400}
      >
        <Form form={extendForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="extendDays"
            label="延长天数"
            rules={[{ required: true, message: '请输入延长天数' }]}
          >
            <InputNumber min={1} max={365} placeholder="输入天数" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 变更套餐弹窗 */}
      <Modal
        title="变更订阅套餐"
        open={changePlanVisible}
        onOk={() => {
          changePlanForm.validateFields().then((values) => {
            changePlanMutation.mutate({ id: id!, data: values });
          });
        }}
        confirmLoading={changePlanMutation.isPending}
        onCancel={() => {
          setChangePlanVisible(false);
          changePlanForm.resetFields();
        }}
        width={400}
      >
        <Form form={changePlanForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="newPlanId"
            label="目标套餐"
            rules={[{ required: true, message: '请选择套餐' }]}
          >
            <Select placeholder="选择新套餐">
              {plans?.list?.map((plan) => (
                <Select.Option key={plan.id} value={plan.id}>
                  {tierConfig[plan.tier]?.text || plan.tier} - ${(plan.priceCents / 100).toFixed(2)}
                  /
                  {plan.billingCycle === 'monthly'
                    ? '月'
                    : plan.billingCycle === 'yearly'
                      ? '年'
                      : '终身'}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SubscriptionDetail;

export const routeConfig = {
  name: 'subscription-detail',
  title: '订阅详情',
  icon: 'EyeOutlined',
  order: 2,
  requireAuth: true,
  hideInMenu: true,
};
