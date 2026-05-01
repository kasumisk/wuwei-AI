import React, { useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { AlertOutlined, DisconnectOutlined, WarningOutlined, SyncOutlined, CopyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  subscriptionApi,
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
  const navigate = useNavigate();
  const { data, isLoading } = useSubscriptionAnomalies({ limit: 20 });
  const [rebuilding, setRebuilding] = useState(false);
  const [resyncingId, setResyncingId] = useState<string | null>(null);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const result = await subscriptionApi.rebuildEntitlements();
      message.success(
        result.mode === 'queued'
          ? `已提交后台任务，jobId=${result.jobId || '-'}`
          : `已重建 ${result.result?.subscriptions ?? 0} 个有效订阅的用户权益`,
      );
    } catch (err: any) {
      message.error(`重建失败: ${err.message}`);
    } finally {
      setRebuilding(false);
    }
  };

  const jumpToPlanMappings = (productId?: string | null) => {
    if (!productId) {
      navigate('/subscription/plans');
      return;
    }
    navigate(`/subscription/plans?productId=${encodeURIComponent(productId)}`);
  };

  const renderCopyableValue = (value?: string | null) => {
    if (!value) return '-';
    return (
      <Space size={4}>
        <Button type="link" size="small" onClick={() => jumpToPlanMappings(value)}>
          {value}
        </Button>
        <Typography.Text
          copyable={{ text: value, tooltips: ['复制', '已复制'] }}
          style={{ fontSize: 12 }}
        >
          <CopyOutlined />
        </Typography.Text>
      </Space>
    );
  };

  const renderMappedDetails = (
    offeringId?: string | null,
    packageId?: string | null,
  ) => {
    if (!offeringId && !packageId) return '-';
    return (
      <Space direction="vertical" size={0}>
        <Typography.Text
          copyable={
            offeringId ? { text: offeringId, tooltips: ['复制 offering', '已复制'] } : false
          }
          style={{ fontSize: 12 }}
        >
          {offeringId ? `offering=${offeringId}` : 'offering=-'}
        </Typography.Text>
        <Typography.Text
          copyable={
            packageId ? { text: packageId, tooltips: ['复制 package', '已复制'] } : false
          }
          style={{ fontSize: 12 }}
        >
          {packageId ? `package=${packageId}` : 'package=-'}
        </Typography.Text>
      </Space>
    );
  };

  const handleResync = async (subscriptionId?: string | null) => {
    if (!subscriptionId) return;
    setResyncingId(subscriptionId);
    try {
      const result = await subscriptionApi.resyncSubscription(subscriptionId, {
        reason: 'Admin anomaly console resync',
      });
      message.success(
        result.mode === 'queued'
          ? `已提交后台重同步，jobId=${result.jobId || '-'}`
          : '已同步完成重同步',
      );
    } catch (err: any) {
      message.error(`重同步失败: ${err.message}`);
    } finally {
      setResyncingId(null);
    }
  };

  const renderSubscriptionActions = (
    subscriptionId?: string | null,
    options?: { resync?: boolean },
  ) => {
    if (!subscriptionId) return '-';
    return (
      <Space size={4} wrap>
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/subscription/detail/${subscriptionId}`)}
        >
          查看订阅
        </Button>
        {options?.resync !== false && (
          <Button
            type="link"
            size="small"
            loading={resyncingId === subscriptionId}
            onClick={() => handleResync(subscriptionId)}
          >
            重同步
          </Button>
        )}
      </Space>
    );
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space>
        <Button onClick={() => navigate('/subscription/list')}>查看订阅列表</Button>
        <Button onClick={() => navigate('/subscription/plans')}>查看套餐目录</Button>
        <Button icon={<SyncOutlined />} loading={rebuilding} onClick={handleRebuild}>
          重建有效权益
        </Button>
      </Space>

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
            {
              title: '商品',
              dataIndex: 'productId',
              render: (value) => renderCopyableValue(value),
            },
            {
              title: '映射',
              render: (_, record) =>
                renderMappedDetails(record.mappedOfferingId, record.mappedPackageId),
            },
            {
              title: '动作',
              render: (_, record) =>
                renderSubscriptionActions(record.subscriptionId, { resync: true }),
            },
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
            {
              title: '商品',
              dataIndex: 'storeProductId',
              render: (value) => renderCopyableValue(value),
            },
            {
              title: '映射',
              render: (_, record) =>
                renderMappedDetails(record.mappedOfferingId, record.mappedPackageId),
            },
            {
              title: '动作',
              render: (_, record) =>
                renderSubscriptionActions(
                  record.subscriptionId || record.relatedSubscriptionId,
                  { resync: true },
                ),
            },
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
            {
              title: '商品',
              dataIndex: 'productId',
              render: (value) => renderCopyableValue(value),
            },
            {
              title: '映射',
              render: (_, record) =>
                renderMappedDetails(record.mappedOfferingId, record.mappedPackageId),
            },
            {
              title: '动作',
              render: (_, record) =>
                renderSubscriptionActions(record.relatedSubscriptionId, {
                  resync: true,
                }),
            },
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
            {
              title: '动作',
              render: (_, record) => renderSubscriptionActions(record.id, { resync: true }),
            },
          ]}
        />
      </Card>
    </Space>
  );
};

export default SubscriptionAnomaliesPage;
