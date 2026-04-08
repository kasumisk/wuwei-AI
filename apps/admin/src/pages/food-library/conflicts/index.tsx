import React, { useRef, useState } from 'react';
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
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  foodLibraryApi,
  type FoodConflictDto,
} from '@/services/foodLibraryService';
import { RESOLUTION_OPTIONS } from '../constants';

export const routeConfig = {
  name: 'food-conflicts',
  title: '冲突管理',
  icon: 'WarningOutlined',
  order: 15,
  requireAuth: true,
  hideInMenu: true,
};

const FoodConflictsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [currentConflict, setCurrentConflict] = useState<FoodConflictDto | null>(null);
  const [resolveForm] = Form.useForm();

  const handleResolve = async () => {
    const values = await resolveForm.validateFields();
    try {
      await foodLibraryApi.resolveConflict(currentConflict!.id, values);
      message.success('冲突已解决');
      setResolveModalOpen(false);
      setCurrentConflict(null);
      resolveForm.resetFields();
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(`处理失败: ${e.message}`);
    }
  };

  const columns: ProColumns<FoodConflictDto>[] = [
    {
      title: '食物名称',
      dataIndex: ['food', 'name'],
      width: 120,
      render: (_, record) => (
        <a onClick={() => record.food?.id && navigate(`/food-library/detail/${record.food.id}`)}>
          {record.food?.name || '-'}
        </a>
      ),
    },
    {
      title: '食物编码',
      dataIndex: ['food', 'code'],
      width: 130,
    },
    {
      title: '冲突字段',
      dataIndex: 'field',
      width: 120,
      render: (v) => <Tag color="orange">{v as string}</Tag>,
    },
    {
      title: '来源数据',
      dataIndex: 'sources',
      width: 300,
      search: false,
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {record.sources?.map((s, i) => (
            <Tag key={i} color="blue">
              {s.source}: {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'resolution',
      width: 100,
      valueEnum: {
        '': { text: '待处理', status: 'Error' },
        manual: { text: '手动选择', status: 'Success' },
        priority: { text: '高优先级', status: 'Success' },
        average: { text: '均值', status: 'Success' },
        ignore: { text: '已忽略', status: 'Default' },
      },
      render: (_, record) =>
        record.resolution ? (
          <Tag color="green">{record.resolution}</Tag>
        ) : (
          <Tag color="red">待处理</Tag>
        ),
    },
    {
      title: '采用值',
      dataIndex: 'resolvedValue',
      width: 100,
      search: false,
    },
    {
      title: '处理人',
      dataIndex: 'resolvedBy',
      width: 100,
      search: false,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
    },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      search: false,
      render: (_, record) =>
        !record.resolution ? (
          <Button
            type="link"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => {
              setCurrentConflict(record);
              setResolveModalOpen(true);
            }}
          >
            解决
          </Button>
        ) : (
          <Typography.Text type="secondary">已处理</Typography.Text>
        ),
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/food-library/list')}>返回列表</Button>
          <Typography.Title level={4} style={{ margin: 0 }}>数据冲突管理</Typography.Title>
        </Space>
      </Card>

      <ProTable<FoodConflictDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, resolution, ...rest } = params;
          const res = await foodLibraryApi.getConflicts({
            page: current,
            pageSize,
            resolution: resolution || undefined,
            ...rest,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="冲突列表"
      />

      {/* 解决冲突弹窗 */}
      <Modal
        title={`解决冲突 - ${currentConflict?.field || ''}`}
        open={resolveModalOpen}
        onCancel={() => { setResolveModalOpen(false); setCurrentConflict(null); resolveForm.resetFields(); }}
        onOk={handleResolve}
      >
        {currentConflict && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong>冲突来源数据：</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {currentConflict.sources?.map((s, i) => (
                <Tag key={i} color="blue" style={{ marginBottom: 4 }}>
                  {s.source}: {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                </Tag>
              ))}
            </div>
          </div>
        )}
        <Form form={resolveForm} layout="vertical">
          <Form.Item name="resolution" label="解决方式" rules={[{ required: true, message: '请选择解决方式' }]}>
            <Select options={RESOLUTION_OPTIONS} />
          </Form.Item>
          <Form.Item name="resolvedValue" label="采用值" rules={[{ required: true, message: '请输入采用值' }]}>
            <Input placeholder="输入最终采用的值" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FoodConflictsPage;
