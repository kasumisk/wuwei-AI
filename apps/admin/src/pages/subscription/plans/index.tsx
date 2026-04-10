import React, { useRef, useState } from 'react';
import {
  Card,
  Button,
  Tag,
  Space,
  message,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
} from 'antd';
import { ReloadOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  subscriptionApi,
  useCreatePlan,
  useUpdatePlan,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type BillingCycle,
} from '@/services/subscriptionManagementService';

// ==================== 常量 ====================

const tierConfig: Record<SubscriptionTier, { color: string; text: string }> = {
  free: { color: 'default', text: '免费' },
  pro: { color: 'blue', text: 'Pro' },
  premium: { color: 'gold', text: 'Premium' },
};

const cycleLabels: Record<BillingCycle, string> = {
  monthly: '月付',
  yearly: '年付',
  lifetime: '终身',
};

// ==================== 主组件 ====================

const SubscriptionPlanManagement: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlanDto | null>(null);
  const [form] = Form.useForm();

  const createMutation = useCreatePlan({
    onSuccess: () => {
      message.success('创建成功');
      setModalVisible(false);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`创建失败: ${err.message}`),
  });

  const updateMutation = useUpdatePlan({
    onSuccess: () => {
      message.success('更新成功');
      setModalVisible(false);
      setEditingPlan(null);
      form.resetFields();
      actionRef.current?.reload();
    },
    onError: (err: any) => message.error(`更新失败: ${err.message}`),
  });

  const handleCreate = () => {
    setEditingPlan(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: SubscriptionPlanDto) => {
    setEditingPlan(record);
    form.setFieldsValue({
      tier: record.tier,
      billingCycle: record.billingCycle,
      priceCents: record.priceCents,
      isActive: record.isActive,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editingPlan) {
      updateMutation.mutate({
        id: editingPlan.id,
        data: {
          priceCents: values.priceCents,
          isActive: values.isActive,
        },
      });
    } else {
      createMutation.mutate(values);
    }
  };

  const columns: ProColumns<SubscriptionPlanDto>[] = [
    {
      title: '套餐等级',
      dataIndex: 'tier',
      width: 120,
      render: (_: unknown, record: SubscriptionPlanDto) => {
        const cfg = tierConfig[record.tier];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '计费周期',
      dataIndex: 'billingCycle',
      width: 100,
      render: (_: unknown, record: SubscriptionPlanDto) =>
        cycleLabels[record.billingCycle] || record.billingCycle,
    },
    {
      title: '价格',
      dataIndex: 'priceCents',
      width: 120,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <span style={{ fontWeight: 600, color: '#722ed1' }}>
          ${(record.priceCents / 100).toFixed(2)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <Tag color={record.isActive ? 'success' : 'default'}>
          {record.isActive ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: SubscriptionPlanDto) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <ProTable<SubscriptionPlanDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="套餐管理"
        columns={columns}
        search={false}
        request={async () => {
          try {
            const {list} = await subscriptionApi.getPlans();
            return { data: list || [], total: list?.length || 0, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
        toolBarRender={() => [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增套餐
          </Button>,
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
        pagination={false}
      />

      <Modal
        title={editingPlan ? '编辑套餐' : '新增套餐'}
        open={modalVisible}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onCancel={() => {
          setModalVisible(false);
          setEditingPlan(null);
          form.resetFields();
        }}
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="tier"
            label="套餐等级"
            rules={[{ required: true, message: '请选择套餐等级' }]}
          >
            <Select disabled={!!editingPlan} placeholder="选择等级">
              <Select.Option value="free">免费</Select.Option>
              <Select.Option value="pro">Pro</Select.Option>
              <Select.Option value="premium">Premium</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="billingCycle"
            label="计费周期"
            rules={[{ required: true, message: '请选择计费周期' }]}
          >
            <Select disabled={!!editingPlan} placeholder="选择周期">
              <Select.Option value="monthly">月付</Select.Option>
              <Select.Option value="yearly">年付</Select.Option>
              <Select.Option value="lifetime">终身</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="priceCents"
            label="价格（美分）"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="例如：999 代表 $9.99" />
          </Form.Item>
          {editingPlan && (
            <Form.Item name="isActive" label="是否启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
};

export default SubscriptionPlanManagement;

export const routeConfig = {
  name: 'subscription-plans',
  title: '套餐管理',
  icon: 'AppstoreOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};
