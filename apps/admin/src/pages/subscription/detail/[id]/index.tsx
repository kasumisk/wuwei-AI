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
  InputNumber,
  Select,
  message,
  Alert,
  Timeline,
  Table,
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
  useSubscriptionPlans,
  type SubscriptionStatus,
  type SubscriptionTier,
  type PaymentChannel,
} from '@/services/subscriptionManagementService';

// ==================== 常量 ====================

const statusConfig: Record<SubscriptionStatus, { color: string; text: string }> = {
  active: { color: 'success', text: '生效中' },
  expired: { color: 'default', text: '已过期' },
  cancelled: { color: 'warning', text: '已取消' },
  canceled: { color: 'warning', text: '已取消' },
  grace_period: { color: 'processing', text: '宽限期' },
  paused: { color: 'default', text: '已暂停' },
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
  const [extendForm] = Form.useForm();
  const [changePlanForm] = Form.useForm();

  const { data: subscription, isLoading } = useSubscriptionDetail(id!, !!id);
  const { data: timeline, isLoading: timelineLoading } = useSubscriptionTimeline(
    id!,
    { limit: 50 },
    !!id,
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
    onSuccess: () => message.success('已触发重同步'),
    onError: (err: any) => message.error(`重同步失败: ${err.message}`),
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

  const sCfg = statusConfig[subscription.status];
  const tCfg = tierConfig[subscription.plan?.tier || 'free'];
  const isExpired = new Date(subscription.expiresAt) < new Date();

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
              icon={<ClockCircleOutlined />}
              onClick={() => setExtendVisible(true)}
              disabled={subscription.status === 'canceled' || subscription.status === 'cancelled'}
            >
              延期
            </Button>
            <Button
              icon={<SwapOutlined />}
              onClick={() => setChangePlanVisible(true)}
              disabled={subscription.status === 'canceled' || subscription.status === 'cancelled'}
            >
              变更套餐
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 订阅信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Tabs
          defaultActiveKey="info"
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="订阅ID">{subscription.id}</Descriptions.Item>
                  <Descriptions.Item label="用户">
                    {subscription.user?.nickname || subscription.user?.email || '匿名'} (
                    {subscription.userId.slice(0, 8)}...)
                  </Descriptions.Item>
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
                    {subscription.platformSubscriptionId || '-'}
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
                        <Typography.Text>
                          Apple: {subscription.plan.appleProductId || '-'}
                        </Typography.Text>
                        <Typography.Text>
                          Google: {subscription.plan.googleProductId || '-'}
                        </Typography.Text>
                        <Typography.Text>
                          WeChat: {subscription.plan.wechatProductId || '-'}
                        </Typography.Text>
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
              label: '权益详情',
              children: subscription.plan?.entitlements ? (
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 8,
                    fontSize: 12,
                    maxHeight: 400,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(subscription.plan.entitlements, null, 2)}
                </pre>
              ) : (
                <Typography.Text type="secondary">暂无权益数据</Typography.Text>
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
                      title: '平台流水号',
                      dataIndex: 'platformTransactionId',
                      ellipsis: true,
                      render: (value?: string | null) => value || '-',
                    },
                    {
                      title: '支付时间',
                      dataIndex: 'paidAt',
                      width: 180,
                      render: (value?: string | null) =>
                        value ? new Date(value).toLocaleString('zh-CN') : '-',
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
                  <Timeline
                    items={[
                      ...timeline.audits.map((item) => ({
                        color: 'blue',
                        children: (
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
                                  2,
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
                        color: 'green',
                        children: (
                          <div>
                            <Typography.Text strong>[Txn] {item.transactionType}</Typography.Text>
                            <div>
                              {item.storeProductId || '-'} / {item.status}
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
                        color: item.processingStatus === 'failed' ? 'red' : 'gray',
                        children: (
                          <div>
                            <Typography.Text strong>
                              [Webhook] {item.eventType || 'unknown'}
                            </Typography.Text>
                            <div>
                              {item.providerEventId} / {item.processingStatus}
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
                    ]}
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
