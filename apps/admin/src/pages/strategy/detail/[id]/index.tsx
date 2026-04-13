import React, { useState } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Space,
  Button,
  Tabs,
  Table,
  message,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Popconfirm,
  Spin,
  Empty,
  Row,
  Col,
  Statistic,
  Progress,
  Alert,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  StopOutlined,
  EditOutlined,
  UserAddOutlined,
  DeleteOutlined,
  GlobalOutlined,
  AimOutlined,
  ExperimentOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useStrategyDetail,
  useUpdateStrategy,
  useActivateStrategy,
  useArchiveStrategy,
  useAssignStrategy,
  useRemoveAssignment,
  strategyApi,
  type StrategyScope,
  type StrategyStatus,
  type StrategyAssignmentDto,
  type AssignmentType,
} from '@/services/strategyManagementService';
import type { ColumnsType } from 'antd/es/table';

export const routeConfig = {
  name: 'strategy-detail',
  title: '策略详情',
  hideInMenu: true,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const scopeConfig: Record<StrategyScope, { color: string; icon: React.ReactNode; text: string }> = {
  global: { color: 'blue', icon: <GlobalOutlined />, text: '全局' },
  goal_type: { color: 'green', icon: <AimOutlined />, text: '目标类型' },
  experiment: { color: 'purple', icon: <ExperimentOutlined />, text: '实验' },
  user: { color: 'orange', icon: <UserOutlined />, text: '用户' },
};

const statusConfig: Record<StrategyStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  active: { color: 'success', text: '激活' },
  archived: { color: 'warning', text: '已归档' },
};

const assignmentTypeConfig: Record<AssignmentType, { color: string; text: string }> = {
  manual: { color: 'blue', text: '手动分配' },
  experiment: { color: 'purple', text: '实验分配' },
  segment: { color: 'cyan', text: '段落分配' },
};

// ==================== 主组件 ====================

const StrategyDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: strategy, isLoading } = useStrategyDetail(id!, !!id);

  // 编辑弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();

  // 分配弹窗
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignForm] = Form.useForm();

  // 批量分配弹窗
  const [batchAssignVisible, setBatchAssignVisible] = useState(false);
  const [batchAssignForm] = Form.useForm();
  const [batchProgress, setBatchProgress] = useState<{
    running: boolean;
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ userId: string; error: string }>;
  }>({ running: false, total: 0, completed: 0, succeeded: 0, failed: 0, errors: [] });

  // 分配列表
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignments, setAssignments] = useState<StrategyAssignmentDto[]>([]);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignmentLoading, setAssignmentLoading] = useState(false);

  const updateMutation = useUpdateStrategy({
    onSuccess: () => {
      message.success('策略更新成功');
      setEditModalVisible(false);
    },
    onError: (error: any) => message.error(`更新失败: ${error.message}`),
  });

  const activateMutation = useActivateStrategy({
    onSuccess: () => message.success('策略已激活'),
    onError: (error: any) => message.error(`激活失败: ${error.message}`),
  });

  const archiveMutation = useArchiveStrategy({
    onSuccess: () => message.success('策略已归档'),
    onError: (error: any) => message.error(`归档失败: ${error.message}`),
  });

  const assignMutation = useAssignStrategy({
    onSuccess: () => {
      message.success('分配成功');
      setAssignModalVisible(false);
      assignForm.resetFields();
      loadAssignments();
    },
    onError: (error: any) => message.error(`分配失败: ${error.message}`),
  });

  const removeMutation = useRemoveAssignment({
    onSuccess: () => {
      message.success('已取消分配');
      loadAssignments();
    },
    onError: (error: any) => message.error(`取消分配失败: ${error.message}`),
  });

  // ==================== 加载分配列表 ====================

  const loadAssignments = async (page = 1) => {
    if (!id) return;
    setAssignmentLoading(true);
    try {
      const res = await strategyApi.getAssignments(id, { page, pageSize: 20 });
      setAssignments(res.list);
      setAssignmentTotal(res.total);
      setAssignmentPage(page);
    } catch {
      message.error('加载分配列表失败');
    } finally {
      setAssignmentLoading(false);
    }
  };

  // ==================== 编辑提交 ====================

  // ==================== 批量分配 ====================

  const handleBatchAssign = async () => {
    if (!id) return;
    try {
      const values = await batchAssignForm.validateFields();
      const raw: string = values.userIds || '';
      // 支持逗号、换行、空格分隔
      const userIds = raw
        .split(/[,\n\s]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      if (userIds.length === 0) {
        message.warning('请输入至少一个用户 ID');
        return;
      }

      // 去重
      const uniqueIds = [...new Set(userIds)];
      if (uniqueIds.length !== userIds.length) {
        message.info(`已自动去重：${userIds.length} → ${uniqueIds.length} 个用户`);
      }

      setBatchProgress({
        running: true,
        total: uniqueIds.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
      });

      const assignmentType = values.assignmentType || 'manual';
      const source = values.source || undefined;
      const activeFrom = values.activeRange?.[0]?.toISOString();
      const activeUntil = values.activeRange?.[1]?.toISOString();

      let succeeded = 0;
      let failed = 0;
      const errors: Array<{ userId: string; error: string }> = [];

      for (let i = 0; i < uniqueIds.length; i++) {
        try {
          await strategyApi.assignStrategy(id, {
            userId: uniqueIds[i],
            assignmentType,
            source,
            activeFrom,
            activeUntil,
          });
          succeeded++;
        } catch (err: any) {
          failed++;
          errors.push({
            userId: uniqueIds[i],
            error: err?.message || '未知错误',
          });
        }
        setBatchProgress((prev) => ({
          ...prev,
          completed: i + 1,
          succeeded,
          failed,
          errors: [...errors],
        }));
      }

      setBatchProgress((prev) => ({ ...prev, running: false }));

      if (failed === 0) {
        message.success(`批量分配完成：${succeeded} 个用户全部成功`);
        setBatchAssignVisible(false);
        batchAssignForm.resetFields();
        setBatchProgress({
          running: false,
          total: 0,
          completed: 0,
          succeeded: 0,
          failed: 0,
          errors: [],
        });
        loadAssignments();
      } else {
        message.warning(`批量分配完成：${succeeded} 成功，${failed} 失败`);
        loadAssignments();
      }
    } catch {
      // 表单验证失败
    }
  };

  const handleEdit = () => {
    if (!strategy) return;
    editForm.setFieldsValue({
      name: strategy.name,
      description: strategy.description || '',
      priority: strategy.priority,
      config: JSON.stringify(strategy.config, null, 2),
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    if (!id) return;
    try {
      const values = await editForm.validateFields();
      updateMutation.mutate({
        id,
        data: {
          name: values.name,
          description: values.description || undefined,
          priority: values.priority,
          config: values.config ? JSON.parse(values.config) : undefined,
        },
      });
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('配置 JSON 解析失败');
    }
  };

  // ==================== 分配提交 ====================

  const handleAssign = async () => {
    if (!id) return;
    try {
      const values = await assignForm.validateFields();
      assignMutation.mutate({
        strategyId: id,
        data: {
          userId: values.userId,
          assignmentType: values.assignmentType,
          source: values.source || undefined,
          activeFrom: values.activeRange?.[0]?.toISOString(),
          activeUntil: values.activeRange?.[1]?.toISOString(),
        },
      });
    } catch {
      // 校验失败
    }
  };

  // ==================== 分配列表列 ====================

  const assignmentColumns: ColumnsType<StrategyAssignmentDto> = [
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 280,
      ellipsis: true,
    },
    {
      title: '分配类型',
      dataIndex: 'assignmentType',
      width: 120,
      render: (type: AssignmentType) => {
        const cfg = assignmentTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.text || type}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (val: string | null) => val || '-',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (active: boolean) => (active ? <Tag color="success">生效中</Tag> : <Tag>已停止</Tag>),
    },
    {
      title: '生效时间',
      key: 'period',
      width: 200,
      render: (_, record) => {
        const from = record.activeFrom
          ? new Date(record.activeFrom).toLocaleDateString()
          : '无限制';
        const until = record.activeUntil
          ? new Date(record.activeUntil).toLocaleDateString()
          : '无限制';
        return `${from} ~ ${until}`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) =>
        record.isActive ? (
          <Popconfirm
            title="确认取消此分配？"
            onConfirm={() =>
              removeMutation.mutate({
                strategyId: id!,
                assignmentId: record.id,
                userId: record.userId,
              })
            }
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              取消
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  if (isLoading || !strategy) {
    return (
      <Card>
        <Spin spinning={isLoading}>{!isLoading && <Empty description="策略不存在" />}</Spin>
      </Card>
    );
  }

  const scopeCfg = scopeConfig[strategy.scope];
  const statusCfg = statusConfig[strategy.status];

  return (
    <>
      {/* 头部 */}
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
            <span>{strategy.name}</span>
            <Tag color={statusCfg.color}>{statusCfg.text}</Tag>
            <Tag>v{strategy.version}</Tag>
          </Space>
        }
        extra={
          <Space>
            {strategy.status !== 'archived' && (
              <Button icon={<EditOutlined />} onClick={handleEdit}>
                编辑
              </Button>
            )}
            {strategy.status === 'draft' && (
              <Popconfirm
                title="激活将替换同范围的现有激活策略，确认？"
                onConfirm={() => activateMutation.mutate(id!)}
              >
                <Button type="primary" icon={<PlayCircleOutlined />}>
                  激活
                </Button>
              </Popconfirm>
            )}
            {strategy.status === 'active' && (
              <Popconfirm
                title="归档后策略将不再生效且不可修改，确认？"
                onConfirm={() => archiveMutation.mutate(id!)}
              >
                <Button danger icon={<StopOutlined />}>
                  归档
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Statistic title="活跃分配数" value={strategy.activeAssignmentCount || 0} />
          </Col>
          <Col span={6}>
            <Statistic title="版本" value={strategy.version} prefix="v" />
          </Col>
          <Col span={6}>
            <Statistic title="优先级" value={strategy.priority} />
          </Col>
          <Col span={6}>
            <Statistic
              title="配置模块数"
              value={
                Object.keys(strategy.config || {}).filter(
                  (k) => (strategy.config as any)[k] != null
                ).length
              }
            />
          </Col>
        </Row>

        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="策略ID">{strategy.id}</Descriptions.Item>
          <Descriptions.Item label="范围">
            <Tag color={scopeCfg.color} icon={scopeCfg.icon}>
              {scopeCfg.text}
            </Tag>
            {strategy.scopeTarget && <Tag>{strategy.scopeTarget}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(strategy.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(strategy.updatedAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {strategy.description || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Tab 页 */}
      <Card style={{ marginTop: 16 }}>
        <Tabs
          defaultActiveKey="config"
          onChange={(key) => {
            if (key === 'assignments') loadAssignments();
          }}
          items={[
            {
              key: 'config',
              label: '策略配置',
              children: (
                <Tabs
                  type="card"
                  items={Object.entries(strategy.config || {})
                    .filter(([, v]) => v != null)
                    .map(([key, value]) => ({
                      key,
                      label: key,
                      children: (
                        <pre
                          style={{
                            background: '#f5f5f5',
                            padding: 16,
                            borderRadius: 8,
                            maxHeight: 400,
                            overflow: 'auto',
                            fontSize: 12,
                            fontFamily: 'monospace',
                          }}
                        >
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      ),
                    }))}
                />
              ),
            },
            {
              key: 'assignments',
              label: '策略分配',
              children: (
                <>
                  <Space style={{ marginBottom: 16 }}>
                    {strategy.status === 'active' && (
                      <>
                        <Button
                          type="primary"
                          icon={<UserAddOutlined />}
                          onClick={() => setAssignModalVisible(true)}
                        >
                          分配给用户
                        </Button>
                        <Button
                          icon={<TeamOutlined />}
                          onClick={() => {
                            setBatchAssignVisible(true);
                            setBatchProgress({
                              running: false,
                              total: 0,
                              completed: 0,
                              succeeded: 0,
                              failed: 0,
                              errors: [],
                            });
                          }}
                        >
                          批量分配
                        </Button>
                      </>
                    )}
                    <Button onClick={() => loadAssignments(assignmentPage)}>刷新</Button>
                  </Space>
                  <Table<StrategyAssignmentDto>
                    rowKey="id"
                    columns={assignmentColumns}
                    dataSource={assignments}
                    loading={assignmentLoading}
                    pagination={{
                      current: assignmentPage,
                      total: assignmentTotal,
                      pageSize: 20,
                      onChange: (p) => loadAssignments(p),
                    }}
                    scroll={{ x: 1000 }}
                    size="small"
                  />
                </>
              ),
            },
            {
              key: 'raw',
              label: '原始 JSON',
              children: (
                <pre
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 8,
                    maxHeight: 600,
                    overflow: 'auto',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  {JSON.stringify(strategy, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title="编辑策略"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleEditSubmit}
        confirmLoading={updateMutation.isPending}
        width={640}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="策略名称"
            rules={[{ required: true, message: '请输入策略名称' }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Input type="number" />
          </Form.Item>
          <Form.Item
            name="config"
            label="策略配置 (JSON)"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject('请输入有效的 JSON');
                  }
                },
              },
            ]}
          >
            <Input.TextArea rows={10} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配弹窗 */}
      <Modal
        title="分配策略给用户"
        open={assignModalVisible}
        onCancel={() => {
          setAssignModalVisible(false);
          assignForm.resetFields();
        }}
        onOk={handleAssign}
        confirmLoading={assignMutation.isPending}
        width={520}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="userId"
            label="用户 ID"
            rules={[{ required: true, message: '请输入用户ID' }]}
          >
            <Input placeholder="用户 UUID" />
          </Form.Item>
          <Form.Item
            name="assignmentType"
            label="分配类型"
            rules={[{ required: true, message: '请选择分配类型' }]}
          >
            <Select
              options={[
                { label: '手动分配', value: 'manual' },
                { label: '实验分配', value: 'experiment' },
                { label: '段落分配', value: 'segment' },
              ]}
            />
          </Form.Item>
          <Form.Item name="source" label="来源标识">
            <Input placeholder="实验ID / 段落名 / 操作人ID（可选）" />
          </Form.Item>
          <Form.Item name="activeRange" label="生效时间范围">
            <DatePicker.RangePicker
              showTime
              style={{ width: '100%' }}
              placeholder={['开始时间（可选）', '结束时间（可选）']}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量分配弹窗 */}
      <Modal
        title={
          <Space>
            <TeamOutlined />
            <span>批量分配策略</span>
          </Space>
        }
        open={batchAssignVisible}
        onCancel={() => {
          if (batchProgress.running) {
            message.warning('批量分配正在执行中，请等待完成');
            return;
          }
          setBatchAssignVisible(false);
          batchAssignForm.resetFields();
          setBatchProgress({
            running: false,
            total: 0,
            completed: 0,
            succeeded: 0,
            failed: 0,
            errors: [],
          });
        }}
        onOk={handleBatchAssign}
        confirmLoading={batchProgress.running}
        okText={batchProgress.running ? '分配中...' : '开始批量分配'}
        okButtonProps={{ disabled: batchProgress.running }}
        width={640}
        maskClosable={!batchProgress.running}
      >
        <Form form={batchAssignForm} layout="vertical">
          <Form.Item
            name="userIds"
            label={
              <Space>
                <span>用户 ID 列表</span>
                <Typography.Text type="secondary">（支持逗号、换行、空格分隔）</Typography.Text>
              </Space>
            }
            rules={[{ required: true, message: '请输入至少一个用户 ID' }]}
          >
            <Input.TextArea
              rows={6}
              placeholder={`粘贴用户 UUID，每行一个或用逗号分隔：\nuuid-001\nuuid-002\nuuid-003`}
              disabled={batchProgress.running}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="assignmentType"
                label="分配类型"
                initialValue="manual"
                rules={[{ required: true, message: '请选择分配类型' }]}
              >
                <Select
                  disabled={batchProgress.running}
                  options={[
                    { label: '手动分配', value: 'manual' },
                    { label: '实验分配', value: 'experiment' },
                    { label: '段落分配', value: 'segment' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source" label="来源标识">
                <Input placeholder="批量操作 / 操作人ID" disabled={batchProgress.running} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="activeRange" label="生效时间范围">
            <DatePicker.RangePicker
              showTime
              style={{ width: '100%' }}
              placeholder={['开始时间（可选）', '结束时间（可选）']}
              disabled={batchProgress.running}
            />
          </Form.Item>
        </Form>

        {/* 批量进度 */}
        {(batchProgress.running || batchProgress.completed > 0) && (
          <div style={{ marginTop: 16 }}>
            <Progress
              percent={
                batchProgress.total > 0
                  ? Math.round((batchProgress.completed / batchProgress.total) * 100)
                  : 0
              }
              status={
                batchProgress.running
                  ? 'active'
                  : batchProgress.failed > 0
                    ? 'exception'
                    : 'success'
              }
            />
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={8}>
                <Statistic
                  title="成功"
                  value={batchProgress.succeeded}
                  suffix={`/ ${batchProgress.total}`}
                  valueStyle={{ color: '#52c41a', fontSize: 16 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="失败"
                  value={batchProgress.failed}
                  valueStyle={{
                    color: batchProgress.failed > 0 ? '#ff4d4f' : '#999',
                    fontSize: 16,
                  }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="进度"
                  value={batchProgress.completed}
                  suffix={`/ ${batchProgress.total}`}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
            </Row>

            {batchProgress.errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 12 }}
                message={`${batchProgress.errors.length} 个用户分配失败`}
                description={
                  <div style={{ maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                    {batchProgress.errors.map((e, i) => (
                      <div key={i}>
                        <Typography.Text code>{e.userId}</Typography.Text>
                        <span style={{ color: '#ff4d4f', marginLeft: 8 }}>{e.error}</span>
                      </div>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

export default StrategyDetail;
