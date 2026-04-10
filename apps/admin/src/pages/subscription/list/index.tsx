import React, { useRef, useState } from 'react';
import { Card, Button, Tag, Space, Row, Col, Statistic, message, Tooltip, Avatar } from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  BarChartOutlined,
  UserOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  subscriptionApi,
  useSubscriptionOverview,
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
  const [statsVisible, setStatsVisible] = useState(false);

  const { data: overview } = useSubscriptionOverview({ enabled: statsVisible });

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
      width: 100,
      search: false,
      render: (_: unknown, record: SubscriptionDto) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/subscription/detail/${record.id}`)}
        >
          详情
        </Button>
      ),
    },
  ];

  // ==================== 渲染 ====================

  return (
    <Card>
      {/* 概览统计卡片 */}
      {statsVisible && overview && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="总订阅数" value={overview.totalSubscriptions} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="活跃订阅"
                value={overview.activeSubscriptions}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Pro 用户"
                value={overview.byTier?.pro || 0}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Premium 用户"
                value={overview.byTier?.premium || 0}
                valueStyle={{ color: '#d48806' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="MRR（月经常性收入）"
                value={(overview.mrr / 100).toFixed(2)}
                prefix="$"
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<SubscriptionDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="订阅用户管理"
        columns={columns}
        scroll={{ x: 1200 }}
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
            key="stats"
            icon={<BarChartOutlined />}
            type={statsVisible ? 'primary' : 'default'}
            onClick={() => setStatsVisible(!statsVisible)}
          >
            {statsVisible ? '隐藏统计' : '显示统计'}
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
