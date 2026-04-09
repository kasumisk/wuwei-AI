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
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  gamificationApi,
  useCreateAchievement,
  useUpdateAchievement,
  useDeleteAchievement,
  type AchievementDto,
  type CreateAchievementDto,
} from '@/services/gamificationService';

export const routeConfig = {
  name: 'achievements',
  title: '成就管理',
  icon: 'StarOutlined',
  order: 31,
  requireAuth: true,
};

const AchievementsPage: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<AchievementDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);

  const createMutation = useCreateAchievement({
    onSuccess: () => {
      message.success('创建成功');
      setFormVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateAchievement({
    onSuccess: () => {
      message.success('更新成功');
      setFormVisible(false);
      setEditing(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteAchievement({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });

  const handleEdit = (record: AchievementDto) => {
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

  const columns: ProColumns<AchievementDto>[] = [
    {
      title: '图标',
      dataIndex: 'icon',
      width: 60,
      search: false,
      render: (v) => <span style={{ fontSize: 20 }}>{(v as string) || '🏆'}</span>,
    },
    { title: '编码', dataIndex: 'code', width: 120 },
    { title: '名称', dataIndex: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', width: 200, ellipsis: true, search: false },
    {
      title: '分类',
      dataIndex: 'category',
      width: 80,
      render: (v) => (v ? <Tag>{v as string}</Tag> : '-'),
    },
    { title: '门槛值', dataIndex: 'threshold', width: 80, search: false },
    {
      title: '奖励类型',
      dataIndex: 'rewardType',
      width: 80,
      search: false,
      render: (v) => v || '-',
    },
    { title: '奖励值', dataIndex: 'rewardValue', width: 80, search: false },
    {
      title: '解锁人数',
      dataIndex: 'unlockCount',
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
      <ProTable<AchievementDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await gamificationApi.getAchievements({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 1000 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="成就列表"
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
            新增成就
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
        title={editing ? '编辑成就' : '新增成就'}
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
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="icon" label="图标（Emoji）">
            <Input maxLength={10} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select
              allowClear
              options={[
                { label: '打卡', value: 'streak' },
                { label: '记录', value: 'record' },
                { label: '饮食', value: 'diet' },
                { label: '社交', value: 'social' },
              ]}
            />
          </Form.Item>
          <Form.Item name="threshold" label="门槛值" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="rewardType" label="奖励类型">
            <Select
              allowClear
              options={[
                { label: '积分', value: 'points' },
                { label: '徽章', value: 'badge' },
                { label: '称号', value: 'title' },
              ]}
            />
          </Form.Item>
          <Form.Item name="rewardValue" label="奖励值">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default AchievementsPage;
