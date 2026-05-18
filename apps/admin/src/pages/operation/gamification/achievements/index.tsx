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
  Row,
  Col,
  Statistic,
  Typography,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  TrophyOutlined,
  CopyOutlined,
  UserOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { BarChart, Bar, ResponsiveContainer } from 'recharts';
import {
  gamificationApi,
  useCreateAchievement,
  useUpdateAchievement,
  useDeleteAchievement,
  type AchievementDto,
} from '@/services/gamificationService';

const { Text } = Typography;

export const routeConfig = {
  name: 'achievements',
  title: '成就管理',
  icon: 'StarOutlined',
  order: 1,
  requireAuth: true,
};

// ==================== 分类配置 ====================

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  streak: { label: '打卡', color: 'orange' },
  record: { label: '记录', color: 'blue' },
  diet: { label: '饮食', color: 'green' },
  social: { label: '社交', color: 'purple' },
};

const REWARD_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  points: { label: '积分', color: 'gold' },
  badge: { label: '徽章', color: 'cyan' },
  title: { label: '称号', color: 'magenta' },
};

const AchievementsPage: React.FC = () => {
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<AchievementDto | null>(null);
  const [form] = Form.useForm();
  const actionRef = useRef<ActionType>(null);
  const [allData, setAllData] = useState<AchievementDto[]>([]);

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

  const handleCopy = (record: AchievementDto) => {
    setEditing(null);
    form.setFieldsValue({
      ...record,
      code: `${record.code}_copy`,
      name: `${record.name}（副本）`,
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
    const totalUnlocks = allData.reduce((s, a) => s + (a.unlockCount ?? 0), 0);
    const categoryDist = allData.reduce(
      (acc, a) => {
        const cat = a.category || 'uncategorized';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const mostUnlocked = [...allData].sort(
      (a, b) => (b.unlockCount ?? 0) - (a.unlockCount ?? 0)
    )[0];
    const leastUnlocked = [...allData]
      .filter((a) => (a.unlockCount ?? 0) > 0)
      .sort((a, b) => (a.unlockCount ?? 0) - (b.unlockCount ?? 0))[0];
    const avgThreshold = allData.reduce((s, a) => s + a.threshold, 0) / total;
    return { total, totalUnlocks, categoryDist, mostUnlocked, leastUnlocked, avgThreshold };
  }, [allData]);

  // 分类柱状图数据
  const categoryChartData = useMemo(() => {
    if (!overview) return [];
    return Object.entries(overview.categoryDist).map(([key, count]) => ({
      name: CATEGORY_CONFIG[key]?.label || key,
      count,
    }));
  }, [overview]);

  const columns: ProColumns<AchievementDto>[] = [
    {
      title: '图标',
      dataIndex: 'icon',
      width: 60,
      search: false,
      render: (v) => <span style={{ fontSize: 20 }}>{(v as string) || '🏆'}</span>,
    },
    { title: '编码', dataIndex: 'code', width: 120, copyable: true },
    { title: '名称', dataIndex: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', width: 200, ellipsis: true, search: false },
    {
      title: '分类',
      dataIndex: 'category',
      width: 80,
      render: (v) => {
        const cat = CATEGORY_CONFIG[v as string];
        return cat ? <Tag color={cat.color}>{cat.label}</Tag> : v ? <Tag>{v as string}</Tag> : '-';
      },
    },
    {
      title: '门槛值',
      dataIndex: 'threshold',
      width: 80,
      search: false,
      sorter: true,
    },
    {
      title: '奖励',
      key: 'reward',
      width: 120,
      search: false,
      render: (_, record) => {
        const rtCfg = REWARD_TYPE_CONFIG[record.rewardType ?? ''];
        return (
          <Space size={4}>
            {rtCfg ? <Tag color={rtCfg.color}>{rtCfg.label}</Tag> : record.rewardType || '-'}
            {record.rewardValue ? <Text strong>x{record.rewardValue}</Text> : null}
          </Space>
        );
      },
    },
    {
      title: '解锁人数',
      dataIndex: 'unlockCount',
      width: 100,
      search: false,
      sorter: true,
      render: (v) => (
        <Space>
          <UserOutlined style={{ color: '#1890ff' }} />
          <Text strong>{v as number}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 160,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Tooltip title="复制为新成就">
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
              <Statistic title="成就总数" value={overview.total} prefix={<TrophyOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="总解锁人次"
                value={overview.totalUnlocks}
                prefix={<UserOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="分类数" value={Object.keys(overview.categoryDist).length} />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="平均门槛" value={overview.avgThreshold.toFixed(0)} />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="最热门成就"
                value={overview.mostUnlocked?.name || '-'}
                valueStyle={{ fontSize: 14 }}
                prefix={<CrownOutlined style={{ color: '#faad14' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <ResponsiveContainer width="100%" height={50}>
                <BarChart
                  data={categoryChartData}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <Bar dataKey="count" fill="#1890ff" barSize={12} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Text type="secondary" style={{ fontSize: 11 }}>
                分类分布
              </Text>
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<AchievementDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await gamificationApi.getAchievements({ page: current, pageSize, ...rest });
          setAllData(res.list || []);
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
