import React, { useState } from 'react';
import { Alert, Button, Card, Popconfirm, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useSubscriptionMaintenanceJobs,
  useSubscriptionMaintenanceDlq,
  subscriptionApi,
  type SubscriptionMaintenanceJobItem,
  type SubscriptionMaintenanceDlqItem,
} from '@/services/subscriptionManagementService';

export const routeConfig = {
  name: 'subscription-jobs',
  title: '维护任务',
  icon: 'SyncOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};

const statusColorMap: Record<string, string> = {
  completed: 'success',
  failed: 'error',
  active: 'processing',
  waiting: 'default',
  delayed: 'warning',
};

const SubscriptionJobsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightJobId = searchParams.get('jobId');
  const [dlqStatus, setDlqStatus] = useState<string | undefined>('pending');
  const [actingDlqId, setActingDlqId] = useState<string | null>(null);
  const { data, isLoading, refetch, isFetching } = useSubscriptionMaintenanceJobs({
    limit: 20,
  });
  const {
    data: dlqData,
    isLoading: dlqLoading,
    refetch: refetchDlq,
    isFetching: dlqFetching,
  } = useSubscriptionMaintenanceDlq({
    limit: 20,
    status: dlqStatus,
  });

  const handleReplay = async (dlqId: string) => {
    setActingDlqId(dlqId);
    try {
      const result = await subscriptionApi.replaySubscriptionMaintenanceDlq(dlqId);
      message.success(`DLQ 已重放，jobId=${result.jobId || '-'}`);
      refetch();
      refetchDlq();
      navigate(`/subscription/jobs?jobId=${encodeURIComponent(result.jobId || '')}`);
    } catch (err: any) {
      message.error(`重放失败: ${err.message}`);
    } finally {
      setActingDlqId(null);
    }
  };

  const handleDiscard = async (dlqId: string) => {
    setActingDlqId(dlqId);
    try {
      await subscriptionApi.discardSubscriptionMaintenanceDlq(dlqId);
      message.success('DLQ 任务已丢弃');
      refetchDlq();
    } catch (err: any) {
      message.error(`丢弃失败: ${err.message}`);
    } finally {
      setActingDlqId(null);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space>
          <Button onClick={() => navigate('/subscription')}>返回工作台</Button>
          <Button onClick={() => navigate('/subscription/anomalies')}>查看异常看板</Button>
        </Space>
        <Button
          icon={<ReloadOutlined />}
          loading={isFetching}
          onClick={() => refetch()}
        >
          刷新
        </Button>
      </Space>

      <Alert
        type="info"
        showIcon
        message="这里展示订阅维护后台任务。Redis/BullMQ 可用时，重同步和权益重建会异步入队；失败任务会在 Worker 重试耗尽后进入 DLQ。"
      />

      <Space size={16} wrap>
        <Card loading={isLoading}>
          <Statistic title="等待中" value={data?.counts.waiting ?? 0} />
        </Card>
        <Card loading={isLoading}>
          <Statistic title="执行中" value={data?.counts.active ?? 0} />
        </Card>
        <Card loading={isLoading}>
          <Statistic title="已完成" value={data?.counts.completed ?? 0} />
        </Card>
        <Card loading={isLoading}>
          <Statistic title="失败" value={data?.counts.failed ?? 0} />
        </Card>
      </Space>

      <Card title="最近任务">
        <Table<SubscriptionMaintenanceJobItem>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.list ?? []}
          pagination={false}
          rowClassName={(record) =>
            record.id === highlightJobId ? 'ant-table-row-selected' : ''
          }
          columns={[
            {
              title: 'Job ID',
              dataIndex: 'id',
              width: 220,
              render: (value: string) => (
                <Typography.Text copyable={{ text: value }}>
                  {value}
                </Typography.Text>
              ),
            },
            {
              title: '动作',
              render: (_, record) =>
                String(record.data?.action || record.name || '-'),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <Tag color={statusColorMap[value] || 'default'}>{value}</Tag>
              ),
            },
            {
              title: '订阅',
              width: 200,
              render: (_, record) => {
                const subscriptionId = String(record.data?.subscriptionId || '');
                if (!subscriptionId) return '-';
                return (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0 }}
                    onClick={() => navigate(`/subscription/detail/${subscriptionId}`)}
                  >
                    {subscriptionId}
                  </Button>
                );
              },
            },
            {
              title: '请求时间',
              dataIndex: 'timestamp',
              width: 180,
              render: (value: number) =>
                value ? new Date(value).toLocaleString('zh-CN') : '-',
            },
            {
              title: '完成时间',
              dataIndex: 'finishedOn',
              width: 180,
              render: (value: number | null) =>
                value ? new Date(value).toLocaleString('zh-CN') : '-',
            },
            {
              title: '重试',
              dataIndex: 'attemptsMade',
              width: 80,
            },
            {
              title: '摘要',
              render: (_, record) => {
                if (record.summary) {
                  return (
                    <Typography.Text
                      type={record.failedReason ? 'danger' : undefined}
                      ellipsis={{ tooltip: record.summary }}
                    >
                      {record.summary}
                    </Typography.Text>
                  );
                }
                return (
                  <Space size={4}>
                    <SyncOutlined spin={record.status === 'active'} />
                    <span>-</span>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <Card
        title="DLQ 失败任务"
        extra={
          <Space>
            <Select
              value={dlqStatus}
              style={{ width: 140 }}
              onChange={(value) => setDlqStatus(value)}
              options={[
                { label: '待处理', value: 'pending' },
                { label: '已重放', value: 'retried' },
                { label: '已丢弃', value: 'discarded' },
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={dlqFetching}
              onClick={() => refetchDlq()}
            >
              刷新
            </Button>
          </Space>
        }
      >
        <Table<SubscriptionMaintenanceDlqItem>
          rowKey="id"
          loading={dlqLoading}
          dataSource={dlqData?.list ?? []}
          pagination={false}
          columns={[
            {
              title: 'DLQ ID',
              dataIndex: 'id',
              width: 220,
              render: (value: string) => (
                <Typography.Text copyable={{ text: value }}>
                  {value}
                </Typography.Text>
              ),
            },
            {
              title: '原任务',
              dataIndex: 'jobId',
              width: 180,
              render: (value: string) => (
                <Typography.Text copyable={{ text: value }}>
                  {value}
                </Typography.Text>
              ),
            },
            {
              title: '动作',
              render: (_, record) => String(record.jobData?.action || '-'),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <Tag color={value === 'pending' ? 'error' : value === 'retried' ? 'success' : 'default'}>
                  {value}
                </Tag>
              ),
            },
            {
              title: '失败原因',
              dataIndex: 'errorMessage',
              render: (value: string) => (
                <Typography.Text type="danger">{value}</Typography.Text>
              ),
            },
            {
              title: '失败时间',
              dataIndex: 'failedAt',
              width: 180,
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              width: 180,
              render: (_, record) => (
                <Space>
                  {record.status === 'pending' && (
                    <Button
                      type="link"
                      size="small"
                      loading={actingDlqId === record.id}
                      onClick={() => handleReplay(record.id)}
                    >
                      重放
                    </Button>
                  )}
                  {record.status === 'pending' && (
                    <Popconfirm
                      title="确认丢弃该 DLQ 任务？"
                      onConfirm={() => handleDiscard(record.id)}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger
                        loading={actingDlqId === record.id}
                      >
                        丢弃
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
};

export default SubscriptionJobsPage;
