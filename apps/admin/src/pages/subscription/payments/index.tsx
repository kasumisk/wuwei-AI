import React, { useRef } from 'react';
import { Card, Button, Tag, Tooltip, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  subscriptionApi,
  type PaymentRecordDto,
  type PaymentChannel,
} from '@/services/subscriptionManagementService';

// ==================== 常量 ====================

const channelConfig: Record<PaymentChannel, { color: string; text: string }> = {
  stripe: { color: 'blue', text: 'Stripe' },
  apple_iap: { color: 'geekblue', text: 'Apple IAP' },
  google_play: { color: 'green', text: 'Google Play' },
  wechat_pay: { color: 'lime', text: '微信支付' },
  alipay: { color: 'gold', text: '支付宝' },
  manual: { color: 'default', text: '人工操作' },
};

const paymentStatusConfig: Record<string, { color: string; text: string }> = {
  succeeded: { color: 'success', text: '成功' },
  success: { color: 'success', text: '成功' },
  pending: { color: 'processing', text: '处理中' },
  failed: { color: 'error', text: '失败' },
  refunded: { color: 'warning', text: '已退款' },
};

// ==================== 主组件 ====================

const PaymentRecordList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

  const columns: ProColumns<PaymentRecordDto>[] = [
    {
      title: '平台流水号',
      dataIndex: 'platformTransactionId',
      width: 200,
      ellipsis: true,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.platformTransactionId ? (
          <Tooltip title={record.platformTransactionId}>
            {record.platformTransactionId.slice(0, 16)}...
          </Tooltip>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
    {
      title: '用户',
      dataIndex: 'userId',
      width: 180,
      render: (_: unknown, record: PaymentRecordDto) => (
        <Space direction="vertical" size={0}>
          <span>{record.user?.nickname || record.user?.email || '匿名'}</span>
          <Typography.Text copyable={{ text: record.userId }} style={{ fontSize: 12 }}>
            {record.userId.slice(0, 8)}...
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '订阅',
      dataIndex: 'subscriptionId',
      width: 220,
      search: false,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.subscriptionId ? (
          <Space direction="vertical" size={0}>
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0, justifyContent: 'flex-start' }}
              onClick={() => navigate(`/subscription/detail/${record.subscriptionId}`)}
            >
              {record.subscription?.plan?.name || '查看订阅'}
            </Button>
            <span style={{ fontSize: 12, color: '#666' }}>
              {record.subscription?.status || '-'} /{' '}
              {record.subscription?.expiresAt
                ? new Date(record.subscription.expiresAt).toLocaleDateString('zh-CN')
                : '-'}
            </span>
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
    {
      title: '金额',
      dataIndex: 'amountCents',
      width: 120,
      search: false,
      sorter: true,
      render: (_: unknown, record: PaymentRecordDto) => (
        <span style={{ fontWeight: 500, color: '#722ed1' }}>
          {record.currency === 'USD' ? '$' : record.currency}{' '}
          {(record.amountCents / 100).toFixed(2)}
        </span>
      ),
    },
    {
      title: '支付渠道',
      dataIndex: 'channel',
      width: 120,
      valueType: 'select',
      valueEnum: {
        stripe: { text: 'Stripe' },
        apple_iap: { text: 'Apple IAP' },
        google_play: { text: 'Google Play' },
        wechat_pay: { text: '微信支付' },
        alipay: { text: '支付宝' },
        manual: { text: '人工操作' },
      },
      render: (_: unknown, record: PaymentRecordDto) => {
        const cfg = channelConfig[record.channel];
        return cfg ? <Tag color={cfg.color}>{cfg.text}</Tag> : record.channel;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        succeeded: { text: '成功', status: 'Success' },
        pending: { text: '处理中', status: 'Processing' },
        failed: { text: '失败', status: 'Error' },
        refunded: { text: '已退款', status: 'Warning' },
      },
      render: (_: unknown, record: PaymentRecordDto) => {
        const cfg = paymentStatusConfig[record.status] || { color: 'default', text: record.status };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 180,
      render: (_: unknown, record: PaymentRecordDto) => (
        <Typography.Text copyable={{ text: record.orderNo }}>
          {record.orderNo}
        </Typography.Text>
      ),
    },
    {
      title: '交易号',
      dataIndex: 'transactionId',
      width: 180,
      search: false,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.transactionId ? (
          <Typography.Text copyable={{ text: record.transactionId }}>
            {record.transactionId}
          </Typography.Text>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.paidAt ? new Date(record.paidAt).toLocaleString('zh-CN') : '-',
    },
    {
      title: '退款信息',
      key: 'refundInfo',
      width: 180,
      search: false,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.refundedAt ? (
          <Space direction="vertical" size={0}>
            <span>
              {(record.refundAmountCents ?? 0) > 0
                ? `${record.currency} ${((record.refundAmountCents ?? 0) / 100).toFixed(2)}`
                : '已退款'}
            </span>
            <span style={{ fontSize: 12, color: '#666' }}>
              {new Date(record.refundedAt).toLocaleString('zh-CN')}
            </span>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
    },
  ];

  return (
    <Card>
      <ProTable<PaymentRecordDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="支付记录"
        columns={columns}
        scroll={{ x: 900 }}
        request={async (params) => {
          try {
            const { list, total } = await subscriptionApi.getPaymentRecords({
              page: params.current,
              pageSize: params.pageSize,
              userId: params.userId || undefined,
              paymentChannel: params.channel || undefined,
              status: params.status || undefined,
              orderNo: params.orderNo || undefined,
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
          showTotal: (total: number) => `共 ${total} 条记录`,
        }}
        search={{ labelWidth: 'auto' }}
      />
    </Card>
  );
};

export default PaymentRecordList;

export const routeConfig = {
  name: 'subscription-payments',
  title: '支付记录',
  icon: 'DollarOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};
