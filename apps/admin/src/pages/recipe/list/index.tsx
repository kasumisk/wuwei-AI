import { useRef, useState } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Row,
  Col,
  Statistic,
  Modal,
  Form,
  InputNumber,
  Select,
  Rate,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  RobotOutlined,
  StarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  recipeApi,
  useRecipeStatistics,
  useDeleteRecipe,
  useGenerateRecipes,
  useRecalculateScores,
  type RecipeListItem,
  type GetRecipesQuery,
  type GenerateRecipesParams,
} from '@/services/recipeManagementService';

// ==================== 常量 ====================

const CUISINE_OPTIONS = [
  { label: '中餐', value: 'chinese' },
  { label: '西餐', value: 'western' },
  { label: '日料', value: 'japanese' },
  { label: '韩餐', value: 'korean' },
  { label: '东南亚', value: 'southeast_asian' },
  { label: '印度菜', value: 'indian' },
  { label: '意大利', value: 'italian' },
  { label: '墨西哥', value: 'mexican' },
  { label: '地中海', value: 'mediterranean' },
  { label: '其他', value: 'other' },
];

const SOURCE_OPTIONS = [
  { label: '系统内置', value: 'system' },
  { label: 'AI生成', value: 'ai_generated' },
  { label: 'UGC', value: 'ugc' },
  { label: '外卖导入', value: 'takeout' },
  { label: '食堂导入', value: 'canteen' },
];

const REVIEW_STATUS_OPTIONS = [
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
];

const GOAL_TYPE_OPTIONS = [
  { label: '减脂', value: 'fat_loss' },
  { label: '增肌', value: 'muscle_gain' },
  { label: '健康', value: 'health' },
];

const DIFFICULTY_MAP: Record<number, { text: string; color: string }> = {
  1: { text: '入门', color: 'green' },
  2: { text: '简单', color: 'cyan' },
  3: { text: '中等', color: 'blue' },
  4: { text: '较难', color: 'orange' },
  5: { text: '困难', color: 'red' },
};

const REVIEW_STATUS_MAP: Record<
  string,
  { text: string; status: 'success' | 'error' | 'warning' | 'processing' | 'default' }
> = {
  approved: { text: '已通过', status: 'success' },
  rejected: { text: '已拒绝', status: 'error' },
  pending: { text: '待审核', status: 'warning' },
};

export const routeConfig = {
  name: 'recipe-list',
  title: '食谱列表',
  order: 1,
  requireAuth: true,
};

export default function RecipeListPage() {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateForm] = Form.useForm<GenerateRecipesParams>();

  // 统计数据
  const { data: stats } = useRecipeStatistics();

  // 删除 mutation
  const { mutate: deleteRecipe } = useDeleteRecipe({
    onSuccess: () => {
      message.success('食谱已删除');
      actionRef.current?.reload();
    },
    onError: (err) => message.error(`删除失败: ${err.message}`),
  });

  // AI生成 mutation
  const { mutate: generateRecipes, isPending: isGenerating } = useGenerateRecipes({
    onSuccess: (result) => {
      if (result.taskId) {
        message.success(`已提交异步生成任务，任务ID: ${result.taskId}`);
      } else {
        message.success(`成功生成 ${result.recipes?.length ?? 0} 个食谱`);
      }
      setGenerateModalOpen(false);
      generateForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (err) => message.error(`生成失败: ${err.message}`),
  });

  // 重算评分 mutation
  const { mutate: recalculate, isPending: isRecalculating } = useRecalculateScores({
    onSuccess: (result) => {
      message.success(`已处理 ${result.processed} 个，更新 ${result.updated} 个评分`);
      actionRef.current?.reload();
    },
    onError: (err) => message.error(`重算失败: ${err.message}`),
  });

  // ==================== 表格列定义 ====================

  const columns: ProColumns<RecipeListItem>[] = [
    {
      title: '食谱名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      copyable: true,
      fixed: 'left',
      hideInSearch: true,
    },
    {
      title: '关键词',
      dataIndex: 'keyword',
      key: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜索食谱名称、描述' },
    },
    {
      title: '菜系',
      dataIndex: 'cuisine',
      key: 'cuisine',
      width: 100,
      valueType: 'select',
      fieldProps: { options: CUISINE_OPTIONS },
      render: (_, record) => (record.cuisine ? <Tag>{record.cuisine}</Tag> : '-'),
    },
    {
      title: '难度',
      dataIndex: 'difficulty',
      key: 'difficulty',
      width: 100,
      valueType: 'select',
      fieldProps: {
        options: [1, 2, 3, 4, 5].map((v) => ({
          label: DIFFICULTY_MAP[v]?.text ?? `${v}`,
          value: v,
        })),
      },
      render: (_, record) => {
        if (!record.difficulty) return '-';
        const d = DIFFICULTY_MAP[record.difficulty];
        return d ? <Tag color={d.color}>{d.text}</Tag> : <Tag>{record.difficulty}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      valueType: 'select',
      fieldProps: { options: SOURCE_OPTIONS },
      render: (_, record) => {
        const opt = SOURCE_OPTIONS.find((o) => o.value === record.source);
        return opt ? <Tag>{opt.label}</Tag> : (record.source ?? '-');
      },
    },
    {
      title: '审核状态',
      dataIndex: 'reviewStatus',
      key: 'reviewStatus',
      width: 100,
      valueType: 'select',
      fieldProps: { options: REVIEW_STATUS_OPTIONS },
      render: (_, record) => {
        if (!record.reviewStatus) return '-';
        const s = REVIEW_STATUS_MAP[record.reviewStatus];
        return s ? <Badge status={s.status} text={s.text} /> : <Tag>{record.reviewStatus}</Tag>;
      },
    },
    {
      title: '热量/份',
      dataIndex: 'caloriesPerServing',
      key: 'caloriesPerServing',
      width: 100,
      hideInSearch: true,
      sorter: true,
      render: (_, record) =>
        record.caloriesPerServing != null ? `${Math.round(record.caloriesPerServing)} kcal` : '-',
    },
    {
      title: '蛋白质/份',
      dataIndex: 'proteinPerServing',
      key: 'proteinPerServing',
      width: 100,
      hideInSearch: true,
      render: (_, record) =>
        record.proteinPerServing != null ? `${record.proteinPerServing.toFixed(1)}g` : '-',
    },
    {
      title: '质量评分',
      dataIndex: 'qualityScore',
      key: 'qualityScore',
      width: 120,
      hideInSearch: true,
      sorter: true,
      render: (_, record) => {
        if (record.qualityScore == null) return '-';
        const score = record.qualityScore;
        const color = score >= 80 ? 'green' : score >= 60 ? 'orange' : 'red';
        return <Tag color={color}>{score.toFixed(1)}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      valueType: 'select',
      fieldProps: {
        options: [
          { label: '启用', value: 'true' },
          { label: '停用', value: 'false' },
        ],
      },
      render: (_, record) =>
        record.isActive ? (
          <Tag icon={<CheckCircleOutlined />} color="success">
            启用
          </Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="default">
            停用
          </Tag>
        ),
    },
    {
      title: '烹饪时间',
      dataIndex: 'cookTimeMinutes',
      key: 'cookTimeMinutes',
      width: 100,
      hideInSearch: true,
      render: (_, record) =>
        record.cookTimeMinutes != null ? `${record.cookTimeMinutes} 分钟` : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      valueType: 'dateTime',
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      hideInSearch: true,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/recipe/detail/${record.id}`)}
          >
            详情
          </Button>
          <Popconfirm
            title="确认删除？"
            description="删除后食谱将被软删除，可通过数据库恢复"
            onConfirm={() => deleteRecipe(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ==================== 统计卡片 ====================

  const renderStatsCards = () => {
    if (!stats) return null;
    return (
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={4}>
            <Statistic title="食谱总数" value={stats.total ?? 0} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic title="已上线" value={stats.active ?? 0} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic title="已下线" value={stats.inactive ?? 0} valueStyle={{ color: '#999' }} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="待审核"
              value={stats.pendingReview ?? 0}
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="平均质量分"
              value={stats.avgQualityScore ?? 0}
              precision={1}
              suffix="/ 100"
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="菜系数"
              value={stats.byCuisine ? Object.keys(stats.byCuisine).length : 0}
            />
          </Col>
        </Row>
      </Card>
    );
  };

  // ==================== AI生成弹窗 ====================

  const renderGenerateModal = () => (
    <Modal
      title="AI 批量生成食谱"
      open={generateModalOpen}
      onCancel={() => {
        setGenerateModalOpen(false);
        generateForm.resetFields();
      }}
      onOk={() => generateForm.submit()}
      confirmLoading={isGenerating}
      okText="开始生成"
      width={520}
    >
      <Form
        form={generateForm}
        layout="vertical"
        onFinish={(values) => generateRecipes(values)}
        initialValues={{ count: 5, maxDifficulty: 3 }}
      >
        <Form.Item name="cuisine" label="菜系" rules={[{ required: true, message: '请选择菜系' }]}>
          <Select options={CUISINE_OPTIONS} placeholder="选择目标菜系" />
        </Form.Item>
        <Form.Item
          name="goalType"
          label="目标类型"
          rules={[{ required: true, message: '请选择目标类型' }]}
        >
          <Select options={GOAL_TYPE_OPTIONS} placeholder="选择健康目标" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="count"
              label="生成数量"
              rules={[{ required: true, message: '请输入数量' }]}
            >
              <InputNumber min={1} max={30} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="maxDifficulty" label="最高难度">
              <Rate count={5} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="maxCookTime" label="最大烹饪时间（分钟）">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="不限制则留空" />
        </Form.Item>
        <Form.Item name="constraints" label="额外约束">
          <Select mode="tags" placeholder="输入约束条件，回车添加（如：低盐、无乳糖）" />
        </Form.Item>
      </Form>
      <div style={{ color: '#999', fontSize: 12 }}>
        提示：生成数量 ≤ 3 时同步返回结果，&gt; 3 时异步处理
      </div>
    </Modal>
  );

  // ==================== 主渲染 ====================

  return (
    <div>
      {renderStatsCards()}
      <ProTable<RecipeListItem>
        columns={columns}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 1600 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="食谱库"
        request={async (params) => {
          const query: GetRecipesQuery = {
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword,
            cuisine: params.cuisine,
            difficulty: params.difficulty ? Number(params.difficulty) : undefined,
            source: params.source,
            reviewStatus: params.reviewStatus,
            isActive:
              params.isActive === 'true' ? true : params.isActive === 'false' ? false : undefined,
          };
          // 清理 undefined
          Object.keys(query).forEach((k) => {
            if ((query as any)[k] === undefined) delete (query as any)[k];
          });
          const res = await recipeApi.getList(query);
          return {
            data: res.list ?? [],
            total: res.total ?? 0,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/recipe/detail/new')}
          >
            新增食谱
          </Button>,
          <Button
            key="generate"
            icon={<RobotOutlined />}
            onClick={() => setGenerateModalOpen(true)}
          >
            AI 生成
          </Button>,
          <Popconfirm
            key="recalc"
            title="重算质量评分"
            description="将重新计算所有食谱的质量评分，可能需要一些时间"
            onConfirm={() => recalculate({ onlyZero: false })}
          >
            <Button icon={<StarOutlined />} loading={isRecalculating}>
              重算评分
            </Button>
          </Popconfirm>,
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />
      {renderGenerateModal()}
    </div>
  );
}
