import React, { useRef } from 'react';
import { Card, Button, Tag, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
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
  manual: { color: 'default', text: '人工操作' },
};

const paymentStatusConfig: Record<string, { color: string; text: string }> = {
  succeeded: { color: 'success', text: '成功' },
  pending: { color: 'processing', text: '处理中' },
  failed: { color: 'error', text: '失败' },
  refunded: { color: 'warning', text: '已退款' },
};

// ==================== 主组件 ====================

const PaymentRecordList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  const columns: ProColumns<PaymentRecordDto>[] = [
    {
      title: '交易ID',
      dataIndex: 'transactionId',
      width: 200,
      ellipsis: true,
      render: (_: unknown, record: PaymentRecordDto) =>
        record.transactionId ? (
          <Tooltip title={record.transactionId}>{record.transactionId.slice(0, 16)}...</Tooltip>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 160,
      render: (_: unknown, record: PaymentRecordDto) => (
        <Tooltip title={record.userId}>{record.userId.slice(0, 8)}...</Tooltip>
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
      render: (_: unknown, record: PaymentRecordDto) => {
        const cfg = channelConfig[record.paymentChannel];
        return cfg ? <Tag color={cfg.color}>{cfg.text}</Tag> : record.paymentChannel;
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
      title: '支付时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      sorter: true,
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
              paymentChannel: params.paymentChannel || undefined,
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
