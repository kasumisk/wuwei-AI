import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  message,
  Descriptions,
  Spin,
  Row,
  Col,
  Form,
  Input,
  InputNumber,
  Select,
  Rate,
  Switch,
  Table,
  Modal,
  Popconfirm,
  Badge,
  Typography,
  Empty,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  TranslationOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useRecipeDetail,
  useCreateRecipe,
  useUpdateRecipe,
  useReviewRecipe,
  useRecipeTranslations,
  useUpsertTranslation,
  useDeleteTranslation,
  type CreateRecipeParams,
  type UpdateRecipeParams,
  type RecipeIngredient,
  type UpsertTranslationParams,
} from '@/services/recipeManagementService';

const { TextArea } = Input;
const { Title, Text } = Typography;

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

const LOCALE_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: '繁體中文', value: 'zh-TW' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' },
];

const DIFFICULTY_MAP: Record<number, string> = {
  1: '入门',
  2: '简单',
  3: '中等',
  4: '较难',
  5: '困难',
};

const REVIEW_STATUS_MAP: Record<string, { text: string; color: string }> = {
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已拒绝', color: 'red' },
  pending: { text: '待审核', color: 'orange' },
};

export const routeConfig = {
  name: 'recipe-detail',
  title: '食谱详情',
  order: 2,
  requireAuth: true,
  hideInMenu: true,
};

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [editing, setEditing] = useState(isNew);
  const [form] = Form.useForm();
  const [ingredients, setIngredients] = useState<Omit<RecipeIngredient, 'id' | 'food'>[]>([]);
  const [translationModalOpen, setTranslationModalOpen] = useState(false);
  const [translationForm] = Form.useForm();
  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected'>('approved');
  const [reviewNote, setReviewNote] = useState('');

  // 数据查询
  const { data: recipe, isLoading } = useRecipeDetail(isNew ? '' : id!);
  const { data: translations, refetch: refetchTranslations } = useRecipeTranslations(
    isNew ? '' : id!
  );

  // Mutations
  const { mutate: createRecipe, isPending: isCreating } = useCreateRecipe({
    onSuccess: (result) => {
      message.success('食谱创建成功');
      navigate(`/recipe/detail/${result.id}`, { replace: true });
    },
    onError: (err) => message.error(`创建失败: ${err.message}`),
  });

  const { mutate: updateRecipe, isPending: isUpdating } = useUpdateRecipe({
    onSuccess: () => {
      message.success('食谱更新成功');
      setEditing(false);
    },
    onError: (err) => message.error(`更新失败: ${err.message}`),
  });

  const { mutate: reviewRecipe, isPending: isReviewing } = useReviewRecipe({
    onSuccess: () => {
      message.success('审核完成');
      setReviewModalOpen(false);
      setReviewNote('');
    },
    onError: (err) => message.error(`审核失败: ${err.message}`),
  });

  const { mutate: upsertTranslation, isPending: isUpsertingTranslation } = useUpsertTranslation({
    onSuccess: () => {
      message.success('翻译保存成功');
      setTranslationModalOpen(false);
      translationForm.resetFields();
      setEditingLocale(null);
      refetchTranslations();
    },
    onError: (err) => message.error(`翻译保存失败: ${err.message}`),
  });

  const { mutate: deleteTranslation } = useDeleteTranslation({
    onSuccess: () => {
      message.success('翻译已删除');
      refetchTranslations();
    },
    onError: (err) => message.error(`删除翻译失败: ${err.message}`),
  });

  // 初始化表单
  useEffect(() => {
    if (recipe && !isNew) {
      form.setFieldsValue({
        name: recipe.name,
        description: recipe.description,
        cuisine: recipe.cuisine,
        difficulty: recipe.difficulty,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        servings: recipe.servings,
        tags: recipe.tags,
        imageUrl: recipe.imageUrl,
        source: recipe.source,
        isActive: recipe.isActive,
        caloriesPerServing: recipe.caloriesPerServing,
        proteinPerServing: recipe.proteinPerServing,
        fatPerServing: recipe.fatPerServing,
        carbsPerServing: recipe.carbsPerServing,
        fiberPerServing: recipe.fiberPerServing,
        instructions:
          typeof recipe.instructions === 'string'
            ? recipe.instructions
            : JSON.stringify(recipe.instructions, null, 2),
      });
      setIngredients(
        (recipe.ingredients ?? []).map((ing) => ({
          foodId: ing.foodId,
          ingredientName: ing.ingredientName,
          amount: ing.amount,
          unit: ing.unit,
          isOptional: ing.isOptional,
          sortOrder: ing.sortOrder,
        }))
      );
    }
  }, [recipe, isNew, form]);

  // ==================== 提交 ====================

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      // 处理 instructions 字段
      let instructions = values.instructions;
      if (typeof instructions === 'string') {
        try {
          instructions = JSON.parse(instructions);
        } catch {
          // 保留原始文本
        }
      }

      const payload = {
        ...values,
        instructions,
        ingredients: ingredients.length > 0 ? ingredients : undefined,
      };

      if (isNew) {
        createRecipe(payload as CreateRecipeParams);
      } else {
        updateRecipe({ id: id!, data: payload as UpdateRecipeParams });
      }
    });
  };

  // ==================== 食材表格 ====================

  const ingredientColumns = [
    {
      title: '食材名称',
      dataIndex: 'ingredientName',
      key: 'ingredientName',
      render: (_: any, record: any, index: number) =>
        editing ? (
          <Input
            value={record.ingredientName}
            onChange={(e) => {
              const newList = [...ingredients];
              newList[index] = { ...newList[index], ingredientName: e.target.value };
              setIngredients(newList);
            }}
            placeholder="食材名称"
          />
        ) : (
          record.ingredientName
        ),
    },
    {
      title: '用量',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (_: any, record: any, index: number) =>
        editing ? (
          <InputNumber
            value={record.amount}
            onChange={(v) => {
              const newList = [...ingredients];
              newList[index] = { ...newList[index], amount: v ?? undefined };
              setIngredients(newList);
            }}
            min={0}
            style={{ width: '100%' }}
          />
        ) : (
          (record.amount ?? '-')
        ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      render: (_: any, record: any, index: number) =>
        editing ? (
          <Input
            value={record.unit}
            onChange={(e) => {
              const newList = [...ingredients];
              newList[index] = { ...newList[index], unit: e.target.value };
              setIngredients(newList);
            }}
            placeholder="g/ml/个"
          />
        ) : (
          (record.unit ?? '-')
        ),
    },
    {
      title: '可选',
      dataIndex: 'isOptional',
      key: 'isOptional',
      width: 60,
      render: (_: any, record: any, index: number) =>
        editing ? (
          <Switch
            size="small"
            checked={record.isOptional}
            onChange={(v) => {
              const newList = [...ingredients];
              newList[index] = { ...newList[index], isOptional: v };
              setIngredients(newList);
            }}
          />
        ) : record.isOptional ? (
          <Tag color="blue">可选</Tag>
        ) : null,
    },
    ...(editing
      ? [
          {
            title: '操作',
            key: 'action',
            width: 60,
            render: (_: any, __: any, index: number) => (
              <Button
                type="link"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => {
                  const newList = [...ingredients];
                  newList.splice(index, 1);
                  setIngredients(newList);
                }}
              />
            ),
          },
        ]
      : []),
  ];

  // ==================== 渲染 ====================

  if (!isNew && isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isNew && !recipe) {
    return (
      <Card>
        <Empty description="食谱不存在或已删除">
          <Button onClick={() => navigate('/recipe/list')}>返回列表</Button>
        </Empty>
      </Card>
    );
  }

  return (
    <div>
      {/* 顶部导航栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/recipe/list')}>
                返回列表
              </Button>
              <Title level={4} style={{ margin: 0 }}>
                {isNew ? '新增食谱' : recipe?.name}
              </Title>
              {!isNew && recipe?.reviewStatus && (
                <Tag color={REVIEW_STATUS_MAP[recipe.reviewStatus]?.color}>
                  {REVIEW_STATUS_MAP[recipe.reviewStatus]?.text ?? recipe.reviewStatus}
                </Tag>
              )}
              {!isNew && (
                <Tag color={recipe?.isActive ? 'green' : 'default'}>
                  {recipe?.isActive ? '已上线' : '已下线'}
                </Tag>
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              {!isNew && !editing && (
                <>
                  <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                    编辑
                  </Button>
                  {recipe?.reviewStatus === 'pending' && (
                    <>
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        onClick={() => {
                          setReviewAction('approved');
                          setReviewModalOpen(true);
                        }}
                      >
                        通过
                      </Button>
                      <Button
                        danger
                        icon={<CloseCircleOutlined />}
                        onClick={() => {
                          setReviewAction('rejected');
                          setReviewModalOpen(true);
                        }}
                      >
                        拒绝
                      </Button>
                    </>
                  )}
                </>
              )}
              {editing && (
                <>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={isCreating || isUpdating}
                    onClick={handleSubmit}
                  >
                    保存
                  </Button>
                  {!isNew && (
                    <Button
                      icon={<CloseOutlined />}
                      onClick={() => {
                        setEditing(false);
                        // 重置表单到原始值
                        if (recipe) {
                          form.setFieldsValue(recipe);
                          setIngredients(
                            (recipe.ingredients ?? []).map((ing) => ({
                              foodId: ing.foodId,
                              ingredientName: ing.ingredientName,
                              amount: ing.amount,
                              unit: ing.unit,
                              isOptional: ing.isOptional,
                              sortOrder: ing.sortOrder,
                            }))
                          );
                        }
                      }}
                    >
                      取消
                    </Button>
                  )}
                </>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        {/* 左侧：基本信息 */}
        <Col xs={24} lg={16}>
          <Card title="基本信息" style={{ marginBottom: 16 }}>
            {editing ? (
              <Form form={form} layout="vertical">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      name="name"
                      label="食谱名称"
                      rules={[{ required: true, message: '请输入名称' }]}
                    >
                      <Input placeholder="输入食谱名称" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="cuisine" label="菜系">
                      <Select options={CUISINE_OPTIONS} allowClear placeholder="选择菜系" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="description" label="描述">
                  <TextArea rows={3} placeholder="食谱简介" />
                </Form.Item>
                <Row gutter={16}>
                  <Col span={6}>
                    <Form.Item name="difficulty" label="难度 (1-5)">
                      <Rate count={5} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="prepTimeMinutes" label="准备时间(分钟)">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="cookTimeMinutes" label="烹饪时间(分钟)">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="servings" label="份数">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name="caloriesPerServing" label="热量/份(kcal)">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="proteinPerServing" label="蛋白质/份(g)">
                      <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="fatPerServing" label="脂肪/份(g)">
                      <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name="carbsPerServing" label="碳水/份(g)">
                      <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="fiberPerServing" label="膳食纤维/份(g)">
                      <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="isActive" label="状态" valuePropName="checked">
                      <Switch checkedChildren="启用" unCheckedChildren="停用" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="tags" label="标签">
                  <Select mode="tags" placeholder="输入标签，回车添加" />
                </Form.Item>
                <Form.Item name="imageUrl" label="图片URL">
                  <Input placeholder="食谱图片链接" />
                </Form.Item>
                {isNew && (
                  <Form.Item name="source" label="来源">
                    <Input placeholder="如: system / ai_generated" />
                  </Form.Item>
                )}
                <Form.Item name="instructions" label="烹饪步骤 (JSON 或纯文本)">
                  <TextArea rows={6} placeholder='[{"step": 1, "text": "..."}]' />
                </Form.Item>
              </Form>
            ) : (
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="食谱名称">{recipe?.name}</Descriptions.Item>
                <Descriptions.Item label="菜系">{recipe?.cuisine ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="描述" span={2}>
                  {recipe?.description ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label="难度">
                  {recipe?.difficulty ? (
                    <Space>
                      <Rate disabled value={recipe.difficulty} count={5} style={{ fontSize: 14 }} />
                      <Text type="secondary">{DIFFICULTY_MAP[recipe.difficulty]}</Text>
                    </Space>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="份数">{recipe?.servings ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="准备时间">
                  {recipe?.prepTimeMinutes != null ? `${recipe.prepTimeMinutes} 分钟` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="烹饪时间">
                  {recipe?.cookTimeMinutes != null ? `${recipe.cookTimeMinutes} 分钟` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="热量/份">
                  {recipe?.caloriesPerServing != null
                    ? `${Math.round(recipe.caloriesPerServing)} kcal`
                    : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="蛋白质/份">
                  {recipe?.proteinPerServing != null
                    ? `${recipe.proteinPerServing.toFixed(1)}g`
                    : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="脂肪/份">
                  {recipe?.fatPerServing != null ? `${recipe.fatPerServing.toFixed(1)}g` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="碳水/份">
                  {recipe?.carbsPerServing != null ? `${recipe.carbsPerServing.toFixed(1)}g` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="膳食纤维/份">
                  {recipe?.fiberPerServing != null ? `${recipe.fiberPerServing.toFixed(1)}g` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="来源">{recipe?.source ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="质量评分">
                  {recipe?.qualityScore != null ? (
                    <Tag
                      color={
                        recipe.qualityScore >= 80
                          ? 'green'
                          : recipe.qualityScore >= 60
                            ? 'orange'
                            : 'red'
                      }
                    >
                      {recipe.qualityScore.toFixed(1)}
                    </Tag>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="标签" span={2}>
                  {recipe?.tags?.length ? (
                    <Space wrap>
                      {recipe.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </Space>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="图片" span={2}>
                  {recipe?.imageUrl ? (
                    <img
                      src={recipe.imageUrl}
                      alt={recipe.name}
                      style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8 }}
                    />
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">{recipe?.createdAt}</Descriptions.Item>
                <Descriptions.Item label="更新时间">{recipe?.updatedAt}</Descriptions.Item>
                {recipe?.reviewedBy && (
                  <>
                    <Descriptions.Item label="审核人">{recipe.reviewedBy}</Descriptions.Item>
                    <Descriptions.Item label="审核时间">
                      {recipe.reviewedAt ?? '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="审核备注" span={2}>
                      {recipe.reviewNote ?? '-'}
                    </Descriptions.Item>
                  </>
                )}
              </Descriptions>
            )}
          </Card>

          {/* 烹饪步骤（仅查看模式） */}
          {!editing && recipe?.instructions && (
            <Card title="烹饪步骤" style={{ marginBottom: 16 }}>
              {Array.isArray(recipe.instructions) ? (
                <ol style={{ paddingLeft: 20 }}>
                  {recipe.instructions.map((step: any, i: number) => (
                    <li key={i} style={{ marginBottom: 8 }}>
                      {typeof step === 'string' ? step : (step.text ?? JSON.stringify(step))}
                    </li>
                  ))}
                </ol>
              ) : typeof recipe.instructions === 'string' ? (
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{recipe.instructions}</pre>
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {JSON.stringify(recipe.instructions, null, 2)}
                </pre>
              )}
            </Card>
          )}
        </Col>

        {/* 右侧：食材列表 + 翻译管理 */}
        <Col xs={24} lg={8}>
          {/* 食材卡片 */}
          <Card
            title="食材列表"
            style={{ marginBottom: 16 }}
            extra={
              editing ? (
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setIngredients([
                      ...ingredients,
                      {
                        ingredientName: '',
                        amount: undefined,
                        unit: undefined,
                        isOptional: false,
                        sortOrder: ingredients.length,
                      },
                    ])
                  }
                >
                  添加食材
                </Button>
              ) : null
            }
          >
            {ingredients.length > 0 || editing ? (
              <Table
                dataSource={ingredients}
                columns={ingredientColumns}
                rowKey={(_, index) => `${index}`}
                pagination={false}
                size="small"
              />
            ) : (
              <Empty description="暂无食材信息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          {/* 翻译管理卡片 */}
          {!isNew && (
            <Card
              title={
                <Space>
                  <GlobalOutlined />
                  翻译管理
                </Space>
              }
              extra={
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingLocale(null);
                    translationForm.resetFields();
                    setTranslationModalOpen(true);
                  }}
                >
                  添加翻译
                </Button>
              }
            >
              {translations && translations.length > 0 ? (
                <div>
                  {translations.map((t) => (
                    <Card
                      key={t.locale}
                      size="small"
                      style={{ marginBottom: 8 }}
                      title={
                        <Space>
                          <TranslationOutlined />
                          <Tag color="blue">{t.locale}</Tag>
                          <Text ellipsis style={{ maxWidth: 150 }}>
                            {t.name}
                          </Text>
                        </Space>
                      }
                      extra={
                        <Space size="small">
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setEditingLocale(t.locale);
                              translationForm.setFieldsValue({
                                locale: t.locale,
                                name: t.name,
                                description: t.description,
                                instructions:
                                  typeof t.instructions === 'string'
                                    ? t.instructions
                                    : t.instructions
                                      ? JSON.stringify(t.instructions, null, 2)
                                      : '',
                              });
                              setTranslationModalOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title={`确认删除 ${t.locale} 翻译？`}
                            onConfirm={() => deleteTranslation({ id: id!, locale: t.locale })}
                          >
                            <Button type="link" size="small" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      }
                    >
                      {t.description && (
                        <Text type="secondary" ellipsis>
                          {t.description}
                        </Text>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <Empty description="暂无翻译" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          )}
        </Col>
      </Row>

      {/* 翻译编辑弹窗 */}
      <Modal
        title={editingLocale ? `编辑翻译 (${editingLocale})` : '添加翻译'}
        open={translationModalOpen}
        onCancel={() => {
          setTranslationModalOpen(false);
          translationForm.resetFields();
          setEditingLocale(null);
        }}
        onOk={() => translationForm.submit()}
        confirmLoading={isUpsertingTranslation}
        okText="保存"
        width={520}
      >
        <Form
          form={translationForm}
          layout="vertical"
          onFinish={(values) => {
            const locale = editingLocale ?? values.locale;
            if (!locale) {
              message.error('请选择语言');
              return;
            }
            let instructions = values.instructions;
            if (typeof instructions === 'string' && instructions.trim()) {
              try {
                instructions = JSON.parse(instructions);
              } catch {
                // 保留原始文本
              }
            }
            const data: UpsertTranslationParams = {
              name: values.name,
              description: values.description,
              instructions: instructions || undefined,
            };
            upsertTranslation({ id: id!, locale, data });
          }}
        >
          {!editingLocale && (
            <Form.Item
              name="locale"
              label="语言"
              rules={[{ required: true, message: '请选择语言' }]}
            >
              <Select options={LOCALE_OPTIONS} placeholder="选择目标语言" />
            </Form.Item>
          )}
          <Form.Item
            name="name"
            label="食谱名称"
            rules={[{ required: true, message: '请输入翻译后的名称' }]}
          >
            <Input placeholder="翻译后的食谱名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} placeholder="翻译后的描述" />
          </Form.Item>
          <Form.Item name="instructions" label="烹饪步骤">
            <TextArea rows={4} placeholder="翻译后的烹饪步骤 (JSON 或纯文本)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 审核弹窗 */}
      <Modal
        title={reviewAction === 'approved' ? '通过审核' : '拒绝审核'}
        open={reviewModalOpen}
        onCancel={() => {
          setReviewModalOpen(false);
          setReviewNote('');
        }}
        onOk={() => {
          reviewRecipe({
            id: id!,
            data: { action: reviewAction, note: reviewNote || undefined },
          });
        }}
        confirmLoading={isReviewing}
        okText={reviewAction === 'approved' ? '确认通过' : '确认拒绝'}
        okButtonProps={{ danger: reviewAction === 'rejected' }}
      >
        <div style={{ marginBottom: 16 }}>
          <Badge
            status={reviewAction === 'approved' ? 'success' : 'error'}
            text={
              reviewAction === 'approved'
                ? '食谱将被标记为已审核通过，可正常展示给用户'
                : '食谱将被标记为已拒绝，不会展示给用户'
            }
          />
        </div>
        <Input.TextArea
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          rows={3}
          placeholder="审核备注（可选）"
        />
      </Modal>
    </div>
  );
}
