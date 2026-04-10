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
  Timeline,
} from 'antd';
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  SwapOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useSubscriptionDetail,
  useExtendSubscription,
  useChangeSubscriptionPlan,
  useSubscriptionPlans,
  type SubscriptionStatus,
  type SubscriptionTier,
  type PaymentChannel,
} from '@/services/subscriptionManagementService';

// ==================== 常量 ====================

const statusConfig: Record<SubscriptionStatus, { color: string; text: string }> = {
  active: { color: 'success', text: '生效中' },
  expired: { color: 'default', text: '已过期' },
  canceled: { color: 'warning', text: '已取消' },
  past_due: { color: 'error', text: '逾期' },
  trialing: { color: 'processing', text: '试用中' },
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
              icon={<ClockCircleOutlined />}
              onClick={() => setExtendVisible(true)}
              disabled={subscription.status === 'canceled'}
            >
              延期
            </Button>
            <Button
              icon={<SwapOutlined />}
              onClick={() => setChangePlanVisible(true)}
              disabled={subscription.status === 'canceled'}
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
                  {subscription.canceledAt && (
                    <Descriptions.Item label="取消时间" span={2}>
                      {new Date(subscription.canceledAt).toLocaleString('zh-CN')}
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
            name="days"
            label="延长天数"
            rules={[{ required: true, message: '请输入延长天数' }]}
          >
            <InputNumber min={1} max={365} placeholder="输入天数" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="延期原因"
            rules={[{ required: true, message: '请输入延期原因' }]}
          >
            <Input.TextArea rows={3} placeholder="请输入延期原因" />
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
              {plans?.map((plan) => (
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
          <Form.Item
            name="reason"
            label="变更原因"
            rules={[{ required: true, message: '请输入变更原因' }]}
          >
            <Input.TextArea rows={3} placeholder="请输入变更原因" />
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
