import React, { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Grid,
  Input,
  Row,
  Space,
  Statistic,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { MessageOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import {
  feedbackManagementApi,
  useAddFeedbackNote,
  useFeedbackDetail,
  useFeedbackStatistics,
  useUpdateFeedbackStatus,
  type AppFeedbackItem,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/services/feedbackManagementService';

const { Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

export const routeConfig = {
  name: 'system-feedback-management',
  title: '用户反馈',
  icon: 'MessageOutlined',
  order: 6,
  requireAuth: true,
  requireAdmin: true,
};

const statusMap: Record<FeedbackStatus, { text: string; color: string }> = {
  open: { text: '待处理', color: 'default' },
  reviewing: { text: '处理中', color: 'processing' },
  resolved: { text: '已解决', color: 'success' },
  closed: { text: '已关闭', color: 'warning' },
};

const categoryMap: Record<FeedbackCategory, string> = {
  general: '一般反馈',
  bug: 'Bug',
  suggestion: '建议',
  account: '账号',
  other: '其他',
};

const statusOptions = Object.entries(statusMap).map(([value, item]) => ({
  value,
  label: item.text,
}));

const categoryOptions = Object.entries(categoryMap).map(([value, label]) => ({
  value,
  label,
}));

const FeedbackManagementPage: React.FC = () => {
  const screens = useBreakpoint();
  const isDesktop = Boolean(screens.lg);
  const actionRef = useRef<ActionType>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [noteForm] = Form.useForm<{ content: string }>();

  const { data: stats, refetch: refetchStats, isLoading: statsLoading } = useFeedbackStatistics();
  const { data: detail, isLoading: detailLoading, refetch: refetchDetail } = useFeedbackDetail(
    selectedId,
  );
  const updateStatusMutation = useUpdateFeedbackStatus();
  const addNoteMutation = useAddFeedbackNote();

  const categoryStats = useMemo(() => stats?.byCategory ?? [], [stats]);
  const detailPanel = detail ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="反馈详情" loading={detailLoading}>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="反馈 ID" span={2}>
            <Text code>{detail.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="用户昵称">{detail.appUsers?.nickname || '-'}</Descriptions.Item>
          <Descriptions.Item label="用户邮箱">{detail.appUsers?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="分类">{categoryMap[detail.category] || detail.category}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="联系方式">{detail.contact || '-'}</Descriptions.Item>
          <Descriptions.Item label="提交时间">
            {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}
          </Descriptions.Item>
          <Descriptions.Item label="反馈内容" span={2}>
            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{detail.content}</Paragraph>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="处理状态">
        <Space wrap>
          {statusOptions.map((item) => (
            <Button
              key={item.value}
              type={detail.status === item.value ? 'primary' : 'default'}
              loading={updateStatusMutation.isPending}
              onClick={() => handleUpdateStatus(item.value as FeedbackStatus)}
            >
              {item.label}
            </Button>
          ))}
        </Space>
      </Card>

      <Card title="跟进记录">
        <Timeline
          items={(detail.metadata?.adminNotes || []).map((note) => ({
            children: (
              <Space direction="vertical" size={2}>
                <Text strong>{note.operator?.username || '管理员'}</Text>
                <Text type="secondary">{dayjs(note.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{note.content}</Paragraph>
              </Space>
            ),
          }))}
        />
        {!detail.metadata?.adminNotes?.length && <Text type="secondary">暂无跟进记录</Text>}
      </Card>

      <Card title="新增跟进记录">
        <Form form={noteForm} layout="vertical">
          <Form.Item
            label="备注内容"
            name="content"
            rules={[
              { required: true, message: '请输入备注内容' },
              { min: 2, message: '至少 2 个字符' },
            ]}
          >
            <Input.TextArea rows={4} maxLength={1000} showCount />
          </Form.Item>
          <Button type="primary" loading={addNoteMutation.isPending} onClick={handleAddNote}>
            添加备注
          </Button>
        </Form>
      </Card>
    </Space>
  ) : (
    <Card>
      <Space direction="vertical" size={8} style={{ width: '100%', alignItems: 'center', padding: 24 }}>
        <MessageOutlined style={{ fontSize: 28, color: '#999' }} />
        <Text type="secondary">从左侧选择一条反馈，查看详情并处理</Text>
      </Space>
    </Card>
  );

  const columns: ProColumns<AppFeedbackItem>[] = [
    {
      title: '反馈 ID',
      dataIndex: 'id',
      width: 180,
      search: false,
      render: (_, record) => <Text code>{record.id.slice(0, 8)}</Text>,
    },
    {
      title: '用户',
      dataIndex: 'userId',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.appUsers?.nickname || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.appUsers?.email || record.userId}
          </Text>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      valueType: 'select',
      valueEnum: Object.fromEntries(
        categoryOptions.map((item) => [item.value, { text: item.label }]),
      ),
      render: (_, record) => categoryMap[record.category] || record.category,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(statusOptions.map((item) => [item.value, { text: item.label }])),
      render: (_, record) => {
        const item = statusMap[record.status];
        return <Tag color={item?.color}>{item?.text || record.status}</Tag>;
      },
    },
    {
      title: '内容',
      dataIndex: 'content',
      ellipsis: true,
      search: false,
      render: (_, record) => <Paragraph ellipsis={{ rows: 2 }}>{record.content}</Paragraph>,
    },
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 100,
      render: (_, record) => [
        <Button
          key="detail"
          type="link"
          onClick={() => {
            setSelectedId(record.id);
          }}
        >
          详情
        </Button>,
      ],
    },
  ];

  const handleUpdateStatus = async (status: FeedbackStatus) => {
    if (!selectedId) return;
    await updateStatusMutation.mutateAsync({ id: selectedId, status });
    message.success('反馈状态已更新');
    refetchDetail();
    refetchStats();
    actionRef.current?.reload();
  };

  const handleAddNote = async () => {
    if (!selectedId) return;
    const values = await noteForm.validateFields();
    await addNoteMutation.mutateAsync({ id: selectedId, content: values.content });
    message.success('跟进记录已添加');
    noteForm.resetFields();
    refetchDetail();
    actionRef.current?.reload();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Card bordered={false} style={{ flex: 1 }}>
          <Text type="secondary">
            查看 App 端用户反馈，跟进处理状态，并记录后台处理备注。
          </Text>
        </Card>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            refetchStats();
            actionRef.current?.reload();
            if (selectedId) {
              refetchDetail();
            }
          }}
        >
          刷新
        </Button>
      </Space>

      <Row gutter={16}>
        <Col span={6}>
          <Card loading={statsLoading}>
            <Statistic title="反馈总数" value={stats?.total ?? 0} prefix={<MessageOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={statsLoading}>
            <Statistic title="待处理" value={stats?.byStatus.open ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={statsLoading}>
            <Statistic title="处理中" value={stats?.byStatus.reviewing ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={statsLoading}>
            <Statistic title="已解决" value={stats?.byStatus.resolved ?? 0} />
          </Card>
        </Col>
      </Row>

      <Card title="分类分布" loading={statsLoading}>
        <Space wrap>
          {categoryStats.map((item) => (
            <Tag key={item.category} color="blue">
              {categoryMap[item.category] || item.category}: {item.count}
            </Tag>
          ))}
        </Space>
      </Card>

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={14} xl={15}>
          <Card bodyStyle={{ padding: 0 }}>
            <ProTable<AppFeedbackItem>
              actionRef={actionRef}
              rowKey="id"
              columns={columns}
              headerTitle="用户反馈列表"
              search={{ labelWidth: 'auto' }}
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              tableAlertRender={false}
              scroll={{ x: 920 }}
              request={async (params) => {
                const { current, pageSize, ...rest } = params;
                const res = await feedbackManagementApi.getList({
                  page: current,
                  pageSize,
                  ...(rest as Record<string, unknown>),
                });
                return { data: res.list, total: res.total, success: true };
              }}
            />
          </Card>
        </Col>

        {isDesktop ? (
          <Col xs={24} lg={10} xl={9}>
            <div style={{ position: 'sticky', top: 16 }}>{detailPanel}</div>
          </Col>
        ) : (
          <Drawer
            open={Boolean(selectedId)}
            title="反馈详情"
            width="100%"
            onClose={() => {
              setSelectedId(undefined);
              noteForm.resetFields();
            }}
            destroyOnClose
          >
            {detailPanel}
          </Drawer>
        )}
      </Row>
    </Space>
  );
};

export default FeedbackManagementPage;
