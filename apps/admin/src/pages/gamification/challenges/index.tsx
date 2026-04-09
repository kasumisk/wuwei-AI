import React, { useState, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  gamificationApi,
  useCreateChallenge,
  useUpdateChallenge,
  useDeleteChallenge,
  useToggleChallengeActive,
  type ChallengeDto,
  type CreateChallengeDto,
} from '@/services/gamificationService';

export const routeConfig = {
  name: 'challenges',
  title: '挑战管理',
  icon: 'FlagOutlined',
  order: 32,
  requireAuth: true,
};

const ChallengesPage: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<ChallengeDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);

  const createMutation = useCreateChallenge({
    onSuccess: () => {
      message.success('创建成功');
      setFormVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateChallenge({
    onSuccess: () => {
      message.success('更新成功');
      setFormVisible(false);
      setEditing(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteChallenge({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const toggleActiveMutation = useToggleChallengeActive({
    onSuccess: () => {
      message.success('状态已更新');
      actionRef.current?.reload();
    },
  });

  const handleEdit = (record: ChallengeDto) => {
    setEditing(record);
    form.setFieldsValue(record);
    setFormVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const columns: ProColumns<ChallengeDto>[] = [
    { title: '标题', dataIndex: 'title', width: 200 },
    { title: '描述', dataIndex: 'description', width: 250, ellipsis: true, search: false },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v) => (v ? <Tag>{v as string}</Tag> : '-'),
    },
    {
      title: '持续天数',
      dataIndex: 'durationDays',
      width: 80,
      search: false,
      render: (v) => `${v} 天`,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      search: false,
      render: (_, record) => (
        <Tag
          color={record.isActive ? 'success' : 'default'}
          style={{ cursor: 'pointer' }}
          onClick={() => toggleActiveMutation.mutate(record.id)}
        >
          {record.isActive ? '进行中' : '已停用'}
        </Tag>
      ),
    },
    {
      title: '参与人数',
      dataIndex: 'participantCount',
      width: 80,
      search: false,
      render: (v) => <Tag color="blue">{v as number}</Tag>,
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
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
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
      <ProTable<ChallengeDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await gamificationApi.getChallenges({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="挑战列表"
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setFormVisible(true);
            }}
          >
            新增挑战
          </Button>,
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
        title={editing ? '编辑挑战' : '新增挑战'}
        open={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select
              allowClear
              options={[
                { label: '连续打卡', value: 'streak' },
                { label: '饮食控制', value: 'diet' },
                { label: '运动', value: 'exercise' },
                { label: '综合', value: 'comprehensive' },
              ]}
            />
          </Form.Item>
          <Form.Item name="durationDays" label="持续天数" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default ChallengesPage;
