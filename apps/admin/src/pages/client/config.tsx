import React, { useState, useRef } from 'react';
import { Button, Space, Tag, message, Popconfirm, Card } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import clientApi, {
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
  type ClientInfoDto,
} from '@/services/clientService';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import type { FormConfig } from '@/types/form';
import ConfigurableProForm from '@/components/ProForm';

// 路由配置
export const routeConfig = {
  name: 'ClientManagement',
  title: '客户端配置',
  icon: <TeamOutlined />,
  order: 2,
  hideInMenu: false,
  requireAuth: true,
  requireAdmin: true,
};

type Client = ClientInfoDto;

const ClientManagement: React.FC = () => {
  const [currentRecord, setCurrentRecord] = useState<Client | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const actionRef = useRef<ActionType>(null);

  // API hooks
  const createMutation = useCreateClient({
    onSuccess: () => {
      message.success('创建成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`创建失败: ${error.message}`);
    },
  });

  const updateMutation = useUpdateClient({
    onSuccess: () => {
      message.success('更新成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`更新失败: ${error.message}`);
    },
  });

  const deleteMutation = useDeleteClient({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      message.error(`删除失败: ${error.message}`);
    },
  });

  // 表格列定义
  const columns: ProColumns<Client>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 280,
      search: false,
    },
    {
      title: '客户端名称',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        '': { text: '全部' },
        active: { text: '激活' },
        suspended: { text: '暂停' },
        inactive: { text: '禁用' },
      },
      render: (_, record: Client) => {
        const statusConfig: any = {
          active: { color: 'green', text: '激活' },
          suspended: { color: 'orange', text: '暂停' },
          inactive: { color: 'red', text: '禁用' },
        };
        const config = statusConfig[record.status] || statusConfig.inactive;
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: true,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      search: false,
      render: (_: unknown, record: Client) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定要删除这个客户端吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 表单配置
  const formConfig: FormConfig = {
    title: isEditMode ? '编辑客户端' : '新增客户端',
    layout: 'vertical',
    fields: [
      {
        name: 'name',
        label: '客户端名称',
        type: 'text',
        required: true,
        fieldProps: {
          placeholder: '请输入客户端名称',
        },
      },
      {
        name: 'description',
        label: '描述',
        type: 'textarea',
        fieldProps: {
          placeholder: '请输入客户端描述',
        },
      },
      {
        name: 'status',
        label: '状态',
        type: 'select',
        fieldProps: {
          options: [
            { label: '激活', value: 'active' },
            { label: '暂停', value: 'suspended' },
            { label: '禁用', value: 'inactive' },
          ],
        },
        initialValue: 'active',
      },
    ],
  };

  // 事件处理函数
  const handleCreate = () => {
    setIsEditMode(false);
    setCurrentRecord(null);
    setModalVisible(true);
  };

  const handleEdit = (record: Client) => {
    setIsEditMode(true);
    setCurrentRecord(record);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    if (isEditMode && currentRecord) {
      updateMutation.mutate({ id: currentRecord.id, data: values });
    } else {
      (createMutation.mutate as any)(values);
    }
  };

  return (
    <Card>
      <ProTable<Client>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="客户端列表"
        columns={columns}
        request={async (params) => {
          try {
            const { list, total } = await clientApi.getClients({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.name,
              status: params.status,
            });

            return {
              data: list || [],
              total: total || 0,
              success: true,
            };
          } catch (error) {
            console.error('获取数据失败:', error);
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增客户端
          </Button>,
        ]}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
        }}
      />

      {/* 新增/编辑表单 */}
      <ConfigurableProForm
        config={formConfig}
        mode="drawer"
        visible={modalVisible}
        onVisibleChange={setModalVisible}
        initialValues={
          (currentRecord ? { ...currentRecord } : { status: 'active' }) as Record<string, any>
        }
        onFinish={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
        width={500}
      />
    </Card>
  );
};

export default ClientManagement;
