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
  Select,
  InputNumber,
  Switch,
  Row,
  Col,
  Statistic,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  foodLibraryApi,
  useCreateFood,
  useUpdateFood,
  useDeleteFood,
  useToggleFoodVerified,
  useFoodLibraryStatistics,
  useFoodLibraryCategories,
  type FoodLibraryDto,
  type CreateFoodLibraryDto,
} from '@/services/foodLibraryService';

// 路由配置
export const routeConfig = {
  name: 'food-list',
  title: '食物列表',
  icon: 'UnorderedListOutlined',
  order: 11,
  requireAuth: true,
  hideInMenu: false,
};

const FOOD_CATEGORIES = ['主食', '肉类', '蔬菜', '水果', '豆制品', '汤类', '饮品', '零食', '快餐', '调味料'];
const MEAL_TYPE_OPTIONS = [
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
];

const FoodLibraryList: React.FC = () => {
  const [editingFood, setEditingFood] = useState<FoodLibraryDto | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm();

  const createMutation = useCreateFood({
    onSuccess: () => { message.success('创建成功'); setFormVisible(false); form.resetFields(); actionRef.current?.reload(); },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateFood({
    onSuccess: () => { message.success('更新成功'); setFormVisible(false); setEditingFood(null); form.resetFields(); actionRef.current?.reload(); },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteFood({
    onSuccess: () => { message.success('已删除'); actionRef.current?.reload(); },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const toggleVerifiedMutation = useToggleFoodVerified({
    onSuccess: () => { message.success('状态已更新'); actionRef.current?.reload(); },
  });

  const { data: stats } = useFoodLibraryStatistics();
  const { data: categories } = useFoodLibraryCategories();

  const handleEdit = (record: FoodLibraryDto) => {
    setEditingFood(record);
    form.setFieldsValue(record);
    setFormVisible(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editingFood) {
      updateMutation.mutate({ id: editingFood.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const columns: ProColumns<FoodLibraryDto>[] = [
    { title: '名称', dataIndex: 'name', width: 120, fixed: 'left' },
    { title: '分类', dataIndex: 'category', width: 80, valueEnum: Object.fromEntries(FOOD_CATEGORIES.map(c => [c, { text: c }])) },
    { title: '热量/100g', dataIndex: 'caloriesPer100g', width: 100, sorter: true, render: (v) => `${v} kcal` },
    { title: '蛋白质', dataIndex: 'proteinPer100g', width: 80, render: (v) => v ? `${v}g` : '-' },
    { title: '脂肪', dataIndex: 'fatPer100g', width: 80, render: (v) => v ? `${v}g` : '-' },
    { title: '碳水', dataIndex: 'carbsPer100g', width: 80, render: (v) => v ? `${v}g` : '-' },
    { title: '品质分', dataIndex: 'qualityScore', width: 70, render: (v) => v || '-' },
    { title: '饱腹感', dataIndex: 'satietyScore', width: 70, render: (v) => v || '-' },
    {
      title: '已验证',
      dataIndex: 'isVerified',
      width: 80,
      render: (_, record) => (
        <Tag
          color={record.isVerified ? 'success' : 'default'}
          style={{ cursor: 'pointer' }}
          onClick={() => toggleVerifiedMutation.mutate(record.id)}
        >
          {record.isVerified ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          {record.isVerified ? ' 是' : ' 否'}
        </Tag>
      ),
    },
    { title: '来源', dataIndex: 'source', width: 80, render: (v) => <Tag>{v as string}</Tag> },
    { title: '搜索权重', dataIndex: 'searchWeight', width: 80, sorter: true },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 160,
      render: (_, record) => (
        <Space wrap size={[0, 4]}>
          {record.tags?.slice(0, 3).map((t) => <Tag key={t} color="blue">{t}</Tag>)}
          {record.tags?.length > 3 && <Tag>+{record.tags.length - 3}</Tag>}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* 统计卡片 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card><Statistic title="食物总数" value={stats.total} /></Card></Col>
          <Col span={6}><Card><Statistic title="已验证" value={stats.verified} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="未验证" value={stats.unverified} valueStyle={{ color: '#cf1322' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="分类数" value={stats.byCategory?.length || 0} /></Card></Col>
        </Row>
      )}

      <ProTable<FoodLibraryDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await foodLibraryApi.getList({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 1400 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="食物库列表"
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => { setEditingFood(null); form.resetFields(); setFormVisible(true); }}>
            新增食物
          </Button>,
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingFood ? '编辑食物' : '新增食物'}
        open={formVisible}
        onCancel={() => { setFormVisible(false); setEditingFood(null); form.resetFields(); }}
        onOk={handleSubmit}
        width={800}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
                <Select options={FOOD_CATEGORIES.map(c => ({ label: c, value: c }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="caloriesPer100g" label="热量(kcal/100g)" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="proteinPer100g" label="蛋白质(g/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="fatPer100g" label="脂肪(g/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="carbsPer100g" label="碳水(g/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="fiberPer100g" label="膳食纤维(g/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sugarPer100g" label="糖(g/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sodiumPer100g" label="钠(mg/100g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="glycemicIndex" label="GI值">
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="standardServingG" label="标准份量(g)">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="qualityScore" label="品质评分(1-10)">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="satietyScore" label="饱腹感(1-10)">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="searchWeight" label="搜索权重">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="mainIngredient" label="主要食材">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="subCategory" label="子分类">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="aliases" label="别名（逗号分隔）">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mealTypes" label="适合餐次">
                <Select mode="multiple" options={MEAL_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}><Form.Item name="isVerified" label="已验证" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="isProcessed" label="加工食品" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="isFried" label="油炸食品" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="source" label="数据来源">
                <Select options={[{ label: '官方', value: 'official' }, { label: '估算', value: 'estimated' }, { label: 'AI', value: 'ai' }]} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
};

export default FoodLibraryList;
