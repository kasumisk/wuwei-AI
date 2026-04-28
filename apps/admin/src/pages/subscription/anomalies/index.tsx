import React from 'react';
import { Alert, Card, Col, Row, Space, Statistic, Table, Tag } from 'antd';
import { AlertOutlined, DisconnectOutlined, WarningOutlined, SyncOutlined } from '@ant-design/icons';
import {
  useSubscriptionAnomalies,
  type ActiveWithoutRevenueCatSignalItem,
  type BillingWebhookEventDto,
  type SubscriptionTransactionDto,
  type UnmappedProductAnomaly,
} from '@/services/subscriptionManagementService';

export const routeConfig = {
  name: 'subscription-anomalies',
  title: '异常看板',
  icon: 'WarningOutlined',
  order: 2,
  requireAuth: true,
  requireAdmin: true,
};

const SubscriptionAnomaliesPage: React.FC = () => {
  const { data, isLoading } = useSubscriptionAnomalies({ limit: 20 });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card loading={isLoading}>
            <Statistic title="失败 Webhook" value={data?.summary.failedWebhookCount ?? 0} prefix={<AlertOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading}>
            <Statistic title="孤儿交易" value={data?.summary.orphanTransactionCount ?? 0} prefix={<DisconnectOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading}>
            <Statistic title="未映射商品" value={data?.summary.unmappedProductCount ?? 0} prefix={<WarningOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={isLoading}>
            <Statistic
              title="本地 Active 但无 RC 信号"
              value={data?.summary.activeWithoutRevenueCatSignalCount ?? 0}
              prefix={<SyncOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Alert
        type="warning"
        showIcon
        message="异常看板用于快速定位订阅链路漂移：Webhook 失败、孤儿交易、商品未映射、本地 active 但缺少 RevenueCat 信号。"
      />

      <Card title="失败 Webhook" loading={isLoading}>
        <Table<BillingWebhookEventDto>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data?.failedWebhooks ?? []}
          columns={[
            { title: '事件', dataIndex: 'eventType' },
            { title: '用户', dataIndex: 'appUserId', render: (value) => value || '-' },
            { title: '商品', dataIndex: 'productId', render: (value) => value || '-' },
            { title: '错误', dataIndex: 'lastError', ellipsis: true, render: (value) => value || '-' },
            { title: '时间', dataIndex: 'receivedAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
          ]}
        />
      </Card>

      <Card title="孤儿交易" loading={isLoading}>
        <Table<SubscriptionTransactionDto>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data?.orphanTransactions ?? []}
          columns={[
            { title: '用户', dataIndex: 'userId', render: (value) => value || '-' },
            { title: '商品', dataIndex: 'storeProductId', render: (value) => value || '-' },
            { title: '类型', dataIndex: 'transactionType' },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
            { title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
          ]}
        />
      </Card>

      <Card title="未映射商品" loading={isLoading}>
        <Table<UnmappedProductAnomaly>
          rowKey={(record) => `${record.source}:${record.productId}:${record.happenedAt}`}
          size="small"
          pagination={false}
          dataSource={data?.unmappedProducts ?? []}
          columns={[
            { title: '来源', dataIndex: 'source', render: (value) => <Tag>{value}</Tag> },
            { title: '商品', dataIndex: 'productId', render: (value) => value || '-' },
            { title: '用户', dataIndex: 'userId', render: (value) => value || '-' },
            { title: '事件', dataIndex: 'eventType', render: (value) => value || '-' },
            { title: '时间', dataIndex: 'happenedAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
          ]}
        />
      </Card>

      <Card title="本地 Active 但无 RevenueCat 信号" loading={isLoading}>
        <Table<ActiveWithoutRevenueCatSignalItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data?.activeWithoutRevenueCatSignals ?? []}
          columns={[
            {
              title: '用户',
              render: (_, record) => record.user?.nickname || record.user?.email || record.userId,
            },
            {
              title: '套餐',
              render: (_, record) => record.plan?.name || '-',
            },
            { title: '渠道', dataIndex: 'paymentChannel' },
            { title: '平台订阅ID', dataIndex: 'platformSubscriptionId', render: (value) => value || '-' },
            { title: '到期时间', dataIndex: 'expiresAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
            { title: '更新时间', dataIndex: 'updatedAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
          ]}
        />
      </Card>
    </Space>
  );
};

export default SubscriptionAnomaliesPage;
