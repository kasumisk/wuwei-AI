import React, { useRef, useState } from 'react';
import {
  Card,
  Tag,
  Button,
  Space,
  Popconfirm,
  message,
  Modal,
  List,
  Avatar,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  EyeOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  contentApi,
  contentQueryKeys,
  useDeleteConversation,
  type ConversationDto,
} from '@/services/contentManagementService';

export const routeConfig = {
  name: 'conversations',
  title: 'AI对话',
  icon: 'CommentOutlined',
  order: 23,
  requireAuth: true,
};

const ConversationsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentConversation, setCurrentConversation] = useState<ConversationDto | null>(null);

  const deleteMutation = useDeleteConversation({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });

  const { data: stats } = useQuery({
    queryKey: contentQueryKeys.conversations.statistics,
    queryFn: () => contentApi.getConversationStatistics(),
    staleTime: 5 * 60 * 1000,
  });

  const handleViewDetail = async (id: string) => {
    const data = await contentApi.getConversationDetail(id);
    setCurrentConversation(data);
    setDetailVisible(true);
  };

  const columns: ProColumns<ConversationDto>[] = [
    {
      title: '用户',
      dataIndex: 'userId',
      width: 120,
      render: (_, record) =>
        record.user?.nickname || record.user?.email || (record.userId as string)?.slice(0, 8),
    },
    { title: '标题', dataIndex: 'title', width: 200, ellipsis: true, render: (v) => v || '无标题' },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '操作',
      width: 120,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            查看
          </Button>
          <Popconfirm title="确认删除该对话？" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card>
              <Statistic title="总对话数" value={stats.totalConversations} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="总消息数" value={stats.totalMessages} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="总Token消耗" value={stats.totalTokensUsed} />
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<ConversationDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await contentApi.getConversations({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="AI 对话列表"
        toolBarRender={() => [
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />

      <Modal
        title={`对话详情 - ${currentConversation?.title || '无标题'}`}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      >
        {currentConversation?.messages && (
          <List
            dataSource={currentConversation.messages}
            renderItem={(msg) => (
              <List.Item style={{ border: 'none', padding: '8px 0' }}>
                <List.Item.Meta
                  avatar={
                    <Avatar
                      icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                      style={{ backgroundColor: msg.role === 'user' ? '#1890ff' : '#52c41a' }}
                    />
                  }
                  title={
                    <Space>
                      <span>{msg.role === 'user' ? '用户' : 'AI 教练'}</span>
                      <Tag>{msg.tokensUsed} tokens</Tag>
                      <span style={{ fontSize: 12, color: '#999' }}>
                        {new Date(msg.createdAt).toLocaleString()}
                      </span>
                    </Space>
                  }
                  description={
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        background: msg.role === 'user' ? '#e6f7ff' : '#f6ffed',
                        padding: '8px 12px',
                        borderRadius: 8,
                        marginTop: 4,
                      }}
                    >
                      {msg.content}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </>
  );
};

export default ConversationsPage;
