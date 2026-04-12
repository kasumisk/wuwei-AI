import React, { useState, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  message,
  Modal,
  Form,
  Input,
  Select,
  Typography,
  Alert,
  Descriptions,
  Row,
  Col,
  Statistic,
  Popconfirm,
} from 'antd';
import { WarningOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { foodLibraryApi, type FoodConflictDto } from '@/services/foodLibraryService';
import { useResolveAllConflicts, useQualityReport } from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'conflicts',
  title: '冲突审核',
  icon: 'WarningOutlined',
  order: 6,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

const RESOLUTION_OPTIONS = [
  { label: '全部', value: '' },
  { label: '待处理', value: 'pending' },
  { label: '自动解决', value: 'auto_resolved' },
  { label: '人工解决', value: 'manual_resolved' },
  { label: '需人工审核', value: 'needs_review' },
];

const ConflictsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [resolveModal, setResolveModal] = useState(false);
  const [currentConflict, setCurrentConflict] = useState<FoodConflictDto | null>(null);
  const [resolveForm] = Form.useForm();
  const { data: report } = useQualityReport();

  const resolveAllConflicts = useResolveAllConflicts({
    onSuccess: () => {
      message.success('批量自动解决完成');
      actionRef.current?.reload();
    },
    onError: (e) => message.error(`解决失败: ${e.message}`),
  });

  const handleResolve = (record: FoodConflictDto) => {
    setCurrentConflict(record);
    resolveForm.resetFields();
    setResolveModal(true);
  };

  const handleSubmitResolve = async () => {
    const values = await resolveForm.validateFields();
    try {
      await foodLibraryApi.resolveConflict(currentConflict!.id, values);
      message.success('冲突已解决');
      setResolveModal(false);
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(`解决失败: ${e.message}`);
    }
  };

  const columns: ProColumns<FoodConflictDto>[] = [
    {
      title: '食物',
      dataIndex: ['food', 'name'],
      width: 150,
      render: (_, record) => record.food?.name || record.foodId?.slice(0, 8),
    },
    {
      title: '冲突字段',
      dataIndex: 'field',
      width: 120,
      render: (v) => <Tag color="orange">{v as string}</Tag>,
    },
    {
      title: '数据来源对比',
      dataIndex: 'sources',
      width: 300,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          {record.sources?.map((s, i) => (
            <div key={i}>
              <Tag color="blue">{s.source}</Tag>
              <Text>{typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}</Text>
            </div>
          ))}
        </Space>
      ),
    },
    {
      title: '解决方式',
      dataIndex: 'resolution',
      width: 120,
      valueEnum: {
        pending: { text: '待处理', status: 'Warning' },
        auto_resolved: { text: '自动解决', status: 'Processing' },
        manual: { text: '人工指定', status: 'Success' },
        priority: { text: '高优先级', status: 'Success' },
        average: { text: '取均值', status: 'Success' },
        ignore: { text: '已忽略', status: 'Default' },
        needs_review: { text: '需人工', status: 'Error' },
      },
    },
    {
      title: '解决值',
      dataIndex: 'resolvedValue',
      width: 120,
      search: false,
      render: (v) => (v ? <Tag color="green">{v as string}</Tag> : '-'),
    },
    {
      title: '解决人',
      dataIndex: 'resolvedBy',
      width: 80,
      search: false,
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
      width: 100,
      search: false,
      render: (_, record) =>
        !record.resolution ||
        record.resolution === 'pending' ||
        record.resolution === 'needs_review' ? (
          <Button type="link" onClick={() => handleResolve(record)}>
            解决
          </Button>
        ) : (
          <Text type="secondary">已解决</Text>
        ),
    },
  ];

  return (
    <div>
      {/* 冲突统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={8}>
          <Card>
            <Statistic title="总冲突数" value={report?.conflicts?.total || 0} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card>
            <Statistic
              title="待处理"
              value={report?.conflicts?.pending || 0}
              valueStyle={{ color: report?.conflicts?.pending ? '#cf1322' : '#3f8600' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col xs={8}>
          <Card>
            <Statistic
              title="已解决"
              value={report?.conflicts?.resolved || 0}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 冲突列表 */}
      <ProTable<FoodConflictDto>
        actionRef={actionRef}
        headerTitle="冲突记录"
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, resolution, ...rest } = params;
          const result = await foodLibraryApi.getConflicts({
            page,
            pageSize,
            resolution: resolution || undefined,
            ...rest,
          });
          return { data: result.list, total: result.total, success: true };
        }}
        pagination={{ pageSize: 20 }}
        toolBarRender={() => [
          <Popconfirm
            key="auto-resolve"
            title="确认自动解决所有待处理冲突？"
            description="系统将根据数据源优先级和差异规则自动解决冲突"
            onConfirm={() => resolveAllConflicts.mutate()}
          >
            <Button
              type="primary"
              danger
              icon={<SyncOutlined />}
              loading={resolveAllConflicts.isPending}
            >
              一键自动解决
            </Button>
          </Popconfirm>,
        ]}
      />

      {/* 人工解决弹窗 */}
      <Modal
        title="人工解决冲突"
        open={resolveModal}
        onCancel={() => setResolveModal(false)}
        onOk={handleSubmitResolve}
      >
        {currentConflict && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="冲突字段">
                <Tag color="orange">{currentConflict.field}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="各来源值">
                {currentConflict.sources?.map((s, i) => (
                  <div key={i}>
                    <Tag color="blue">{s.source}</Tag>:{' '}
                    {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                  </div>
                ))}
              </Descriptions.Item>
            </Descriptions>
            <Form form={resolveForm} layout="vertical">
              <Form.Item name="resolution" label="解决方式" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: '手动指定值', value: 'manual' },
                    { label: '采用高优先级来源', value: 'priority' },
                    { label: '取均值', value: 'average' },
                    { label: '忽略此冲突', value: 'ignore' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="resolvedValue" label="解决值" rules={[{ required: true }]}>
                <Input placeholder="输入最终采用的值" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ConflictsPage;
