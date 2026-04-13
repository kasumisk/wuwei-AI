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
  Input,
  Select,
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

const channelConfig: Record<PaymentChannel, { text: string }> = {
  stripe: { text: 'Stripe' },
  apple_iap: { text: 'Apple IAP' },
  google_play: { text: 'Google Play' },
  wechat_pay: { text: '微信支付' },
  manual: { text: '人工操作' },
};

// ==================== 主组件 ====================

const SubscriptionList: React.FC = () => {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);

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
    extendForm.setFieldsValue({ days: 30, reason: '' });
    setExtendVisible(true);
  };

  const handleExtendSubmit = async () => {
    const values = await extendForm.validateFields();
    if (!extendingRecord) return;
    extendMutation.mutate({
      id: extendingRecord.id,
      data: { days: values.days, reason: values.reason },
    });
  };

  const handleChangePlan = (record: SubscriptionDto) => {
    setChangingRecord(record);
    changePlanForm.setFieldsValue({ newPlanId: '', reason: '' });
    setChangePlanVisible(true);
  };

  const handleChangePlanSubmit = async () => {
    const values = await changePlanForm.validateFields();
    if (!changingRecord) return;
    changePlanMutation.mutate({
      id: changingRecord.id,
      data: { newPlanId: values.newPlanId, reason: values.reason },
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
        expired: { text: '已过期', status: 'Default' },
        canceled: { text: '已取消', status: 'Warning' },
        past_due: { text: '逾期', status: 'Error' },
        trialing: { text: '试用中', status: 'Processing' },
      },
      render: (_: unknown, record: SubscriptionDto) => {
        const cfg = statusConfig[record.status];
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
          {record.status === 'active' && (
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
          label: `${tierConfig[p.tier as SubscriptionTier]?.text || p.tier} - ${p.billingCycle === 'monthly' ? '月付' : p.billingCycle === 'yearly' ? '年付' : '终身'} ($${(p.priceCents / 100).toFixed(2)})`,
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
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable loading={overviewLoading}>
            <Tooltip title="按支付渠道统计">
              <Statistic
                title="渠道数"
                value={overview ? Object.keys(overview.byChannel).length : '-'}
                valueStyle={{ fontSize: 22 }}
              />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {/* 渠道分布标签 */}
      {overview && Object.keys(overview.byChannel).length > 0 && (
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
      )}

      {/* 表格 */}
      <Card>
        <ProTable<SubscriptionDto>
          actionRef={actionRef}
          rowKey="id"
          headerTitle="订阅用户管理"
          columns={columns}
          scroll={{ x: 1400 }}
          request={async (params) => {
            try {
              const { list, total } = await subscriptionApi.getSubscriptions({
                page: params.current,
                pageSize: params.pageSize,
                status: params.status || undefined,
                tier: params['plan,tier'] || params.tier || undefined,
                paymentChannel: params.paymentChannel || undefined,
                keyword: params.userId || undefined,
              });
              return { data: list || [], total: total || 0, success: true };
            } catch {
              return { data: [], total: 0, success: false };
            }
          }}
          toolBarRender={() => [
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
            name="days"
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
          <Form.Item
            label="延期原因"
            name="reason"
            rules={[{ required: true, message: '请输入延期原因' }]}
          >
            <Input.TextArea placeholder="请输入延期原因" rows={3} />
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
          <Form.Item
            label="换餐原因"
            name="reason"
            rules={[{ required: true, message: '请输入换餐原因' }]}
          >
            <Input.TextArea placeholder="请输入换套餐原因" rows={3} />
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
