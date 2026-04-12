import React, { useState, useRef, useMemo } from 'react';
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
  Row,
  Col,
  Statistic,
  Badge,
  Typography,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FlagOutlined,
  UserOutlined,
  CheckCircleOutlined,
  PauseCircleOutlined,
  CopyOutlined,
  TeamOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
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

const { Text } = Typography;

export const routeConfig = {
  name: 'challenges',
  title: '挑战管理',
  icon: 'FlagOutlined',
  order: 32,
  requireAuth: true,
};

// ==================== 类型配置 ====================

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  streak: { label: '连续打卡', color: 'orange' },
  diet: { label: '饮食控制', color: 'green' },
  exercise: { label: '运动', color: 'blue' },
  comprehensive: { label: '综合', color: 'purple' },
};

const ChallengesPage: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<ChallengeDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);
  const [allData, setAllData] = useState<ChallengeDto[]>([]);

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

  const handleCopy = (record: ChallengeDto) => {
    setEditing(null);
    form.setFieldsValue({
      title: `${record.title}（副本）`,
      description: record.description,
      type: record.type,
      durationDays: record.durationDays,
    });
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

  // 概览统计
  const overview = useMemo(() => {
    if (!allData.length) return null;
    const total = allData.length;
    const active = allData.filter((c) => c.isActive).length;
    const inactive = total - active;
    const totalParticipants = allData.reduce((s, c) => s + (c.participantCount ?? 0), 0);
    const avgDuration = allData.reduce((s, c) => s + c.durationDays, 0) / total;
    const mostPopular = [...allData].sort(
      (a, b) => (b.participantCount ?? 0) - (a.participantCount ?? 0)
    )[0];
    return { total, active, inactive, totalParticipants, avgDuration, mostPopular };
  }, [allData]);

  const columns: ProColumns<ChallengeDto>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      width: 200,
      render: (_, record) => (
        <Space>
          <Text strong>{record.title}</Text>
          {record.isActive && <Badge status="processing" />}
        </Space>
      ),
    },
    { title: '描述', dataIndex: 'description', width: 250, ellipsis: true, search: false },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v) => {
        const cfg = TYPE_CONFIG[v as string];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : v ? <Tag>{v as string}</Tag> : '-';
      },
    },
    {
      title: '持续天数',
      dataIndex: 'durationDays',
      width: 90,
      search: false,
      sorter: true,
      render: (v) => (
        <Space>
          <CalendarOutlined style={{ color: '#1890ff' }} />
          <Text>{v as number} 天</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 90,
      search: false,
      render: (_, record) =>
        record.isActive ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            进行中
          </Tag>
        ) : (
          <Tag color="default" icon={<PauseCircleOutlined />}>
            已停用
          </Tag>
        ),
    },
    {
      title: '参与人数',
      dataIndex: 'participantCount',
      width: 100,
      search: false,
      sorter: true,
      render: (v) => (
        <Space>
          <TeamOutlined style={{ color: '#1890ff' }} />
          <Text strong>{v as number}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 200,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={() => toggleActiveMutation.mutate(record.id)}
            loading={toggleActiveMutation.isPending}
          >
            {record.isActive ? '停用' : '启用'}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Tooltip title="复制为新挑战">
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(record)}
            />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* 常驻概览卡片行 */}
      {overview && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="挑战总数" value={overview.total} prefix={<FlagOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="进行中"
                value={overview.active}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已停用"
                value={overview.inactive}
                prefix={<PauseCircleOutlined />}
                valueStyle={{ color: '#999' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="总参与人次"
                value={overview.totalParticipants}
                prefix={<TeamOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="平均时长" value={overview.avgDuration.toFixed(0)} suffix="天" />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="最热门挑战"
                value={overview.mostPopular?.title || '-'}
                valueStyle={{ fontSize: 14 }}
                prefix={<UserOutlined style={{ color: '#faad14' }} />}
              />
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<ChallengeDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await gamificationApi.getChallenges({ page: current, pageSize, ...rest });
          setAllData(res.list || []);
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
