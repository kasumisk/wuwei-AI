import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Tabs,
  Table,
  Descriptions,
  Badge,
  Form,
  Input,
  Select,
  Modal,
  Typography,
  Spin,
  Row,
  Col,
} from 'antd';
import {
  EditOutlined,
  ArrowLeftOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  WarningOutlined,
  PlusOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  foodLibraryApi,
  useFoodDetail,
  useFoodTranslations,
  useFoodSources,
  useFoodChangeLogs,
  useToggleFoodVerified,
  type FoodTranslationDto,
  type FoodSourceDto,
  type FoodChangeLogDto,
  foodLibraryQueryKeys,
} from '@/services/foodLibraryService';
import { useQueryClient } from '@tanstack/react-query';
import {
  STATUS_MAP,
  SOURCE_MAP,
  CATEGORY_MAP,
  ACTION_COLORS,
  LOCALE_OPTIONS,
} from '../../constants';

export const routeConfig = {
  name: 'food-detail',
  title: '食物详情',
  icon: 'EyeOutlined',
  order: 12,
  requireAuth: true,
  hideInMenu: true,
};

const FoodDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: food, isLoading } = useFoodDetail(id!, !!id);
  const { data: translations } = useFoodTranslations(id!, !!id);
  const { data: sources } = useFoodSources(id!, !!id);
  const { data: changeLogs } = useFoodChangeLogs(id!, !!id);

  const [translationModalOpen, setTranslationModalOpen] = useState(false);
  const [translationForm] = Form.useForm();

  const toggleVerifiedMutation = useToggleFoodVerified({
    onSuccess: () => {
      message.success('状态已更新');
      queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.detail(id!) });
    },
  });

  const handleAddTranslation = async () => {
    const values = await translationForm.validateFields();
    try {
      await foodLibraryApi.createTranslation(id!, values);
      message.success('翻译已添加');
      translationForm.resetFields();
      setTranslationModalOpen(false);
      queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.translations(id!) });
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDeleteTranslation = async (translationId: string) => {
    try {
      await foodLibraryApi.deleteTranslation(translationId);
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.translations(id!) });
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    try {
      await foodLibraryApi.deleteSource(sourceId);
      message.success('已删除');
      queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.sources(id!) });
    } catch (e: any) {
      message.error(e.message);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!food) {
    return (
      <Card>
        <Typography.Text type="danger">未找到食物数据</Typography.Text>
        <Button type="link" onClick={() => navigate('/food-library/list')}>
          返回列表
        </Button>
      </Card>
    );
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/food-library/list')}>
                返回列表
              </Button>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {food.name}
              </Typography.Title>
              <Tag>{food.code}</Tag>
              <Badge
                status={food.status === 'active' ? 'success' : 'default'}
                text={STATUS_MAP[food.status]?.text || food.status}
              />
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<CheckCircleOutlined />}
                onClick={() => toggleVerifiedMutation.mutate(id!)}
              >
                {food.isVerified ? '取消验证' : '标记验证'}
              </Button>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => navigate(`/food-library/edit/${id}`)}
              >
                编辑
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card>
        <Tabs
          defaultActiveKey="info"
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <div>
                  <Typography.Title level={5}>基础信息</Typography.Title>
                  <Descriptions bordered column={3} size="small">
                    <Descriptions.Item label="编码">{food.code}</Descriptions.Item>
                    <Descriptions.Item label="名称">{food.name}</Descriptions.Item>
                    <Descriptions.Item label="别名">{food.aliases || '-'}</Descriptions.Item>
                    <Descriptions.Item label="条形码">{food.barcode || '-'}</Descriptions.Item>
                    <Descriptions.Item label="分类">
                      {CATEGORY_MAP[food.category] || food.category}
                    </Descriptions.Item>
                    <Descriptions.Item label="二级分类">
                      {food.subCategory || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="多样性分组">
                      {food.foodGroup || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="主要食材">
                      {food.mainIngredient || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="加工食品">
                      {food.isProcessed ? '是' : '否'}
                    </Descriptions.Item>
                    <Descriptions.Item label="油炸食品">
                      {food.isFried ? '是' : '否'}
                    </Descriptions.Item>
                    <Descriptions.Item label="NOVA分级">{food.processingLevel}</Descriptions.Item>
                    <Descriptions.Item label="份量">
                      {food.standardServingG}g — {food.standardServingDesc || '-'}
                    </Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    宏量营养素 (per 100g)
                  </Typography.Title>
                  <Descriptions bordered column={4} size="small">
                    <Descriptions.Item label="热量">{food.calories} kcal</Descriptions.Item>
                    <Descriptions.Item label="蛋白质">{food.protein ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="脂肪">{food.fat ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="碳水">{food.carbs ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="膳食纤维">{food.fiber ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="糖">{food.sugar ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="饱和脂肪">
                      {food.saturatedFat ?? '-'} g
                    </Descriptions.Item>
                    <Descriptions.Item label="反式脂肪">{food.transFat ?? '-'} g</Descriptions.Item>
                    <Descriptions.Item label="胆固醇">
                      {food.cholesterol ?? '-'} mg
                    </Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    微量营养素 (per 100g)
                  </Typography.Title>
                  <Descriptions bordered column={4} size="small">
                    <Descriptions.Item label="钠">{food.sodium ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="钾">{food.potassium ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="钙">{food.calcium ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="铁">{food.iron ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="锌">{food.zinc ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="镁">{food.magnesium ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="维生素A">{food.vitaminA ?? '-'} μg</Descriptions.Item>
                    <Descriptions.Item label="维生素C">{food.vitaminC ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="维生素D">{food.vitaminD ?? '-'} μg</Descriptions.Item>
                    <Descriptions.Item label="维生素E">{food.vitaminE ?? '-'} mg</Descriptions.Item>
                    <Descriptions.Item label="维生素B12">
                      {food.vitaminB12 ?? '-'} μg
                    </Descriptions.Item>
                    <Descriptions.Item label="叶酸">{food.folate ?? '-'} μg</Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    健康评估 & 决策引擎
                  </Typography.Title>
                  <Descriptions bordered column={4} size="small">
                    <Descriptions.Item label="GI值">{food.glycemicIndex ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="GL值">{food.glycemicLoad ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="品质评分">
                      {food.qualityScore ?? '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="饱腹感">{food.satietyScore ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="营养密度">
                      {food.nutrientDensity ?? '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="搜索权重">{food.searchWeight}</Descriptions.Item>
                    <Descriptions.Item label="热门度">{food.popularity}</Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    数据溯源
                  </Typography.Title>
                  <Descriptions bordered column={3} size="small">
                    <Descriptions.Item label="数据来源">
                      {SOURCE_MAP[food.primarySource] || food.primarySource}
                    </Descriptions.Item>
                    <Descriptions.Item label="来源ID">
                      {food.primarySourceId || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="置信度">
                      {(food.confidence * 100).toFixed(0)}%
                    </Descriptions.Item>
                    <Descriptions.Item label="数据版本">v{food.dataVersion}</Descriptions.Item>
                    <Descriptions.Item label="已验证">
                      {food.isVerified ? <Tag color="success">是</Tag> : <Tag>否</Tag>}
                    </Descriptions.Item>
                    <Descriptions.Item label="审核人">{food.verifiedBy || '-'}</Descriptions.Item>
                    <Descriptions.Item label="创建时间">{food.createdAt}</Descriptions.Item>
                    <Descriptions.Item label="更新时间">{food.updatedAt}</Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    标签 & 分类属性
                  </Typography.Title>
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label="标签">
                      {food.tags?.map((t) => (
                        <Tag key={t} color="blue">
                          {t}
                        </Tag>
                      )) || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="适合餐次">
                      {food.mealTypes?.map((m) => (
                        <Tag key={m} color="green">
                          {m}
                        </Tag>
                      )) || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="过敏原">
                      {food.allergens?.length > 0
                        ? food.allergens.map((a) => (
                            <Tag key={a} color="red">
                              {a}
                            </Tag>
                          ))
                        : '-'}
                    </Descriptions.Item>
                  </Descriptions>
                </div>
              ),
            },
            {
              key: 'translations',
              label: (
                <>
                  <GlobalOutlined /> 多语言翻译 ({translations?.length || 0})
                </>
              ),
              children: (
                <>
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    style={{ marginBottom: 12 }}
                    onClick={() => setTranslationModalOpen(true)}
                  >
                    添加翻译
                  </Button>
                  <Table<FoodTranslationDto>
                    dataSource={translations || []}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    columns={[
                      { title: '语言', dataIndex: 'locale', width: 80 },
                      { title: '名称', dataIndex: 'name', width: 150 },
                      { title: '别名', dataIndex: 'aliases', width: 150 },
                      { title: '描述', dataIndex: 'description', ellipsis: true },
                      { title: '份量描述', dataIndex: 'servingDesc', width: 120 },
                      {
                        title: '操作',
                        width: 80,
                        render: (_, record) => (
                          <Popconfirm
                            title="确认删除？"
                            onConfirm={() => handleDeleteTranslation(record.id)}
                          >
                            <Button type="link" size="small" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                  <Modal
                    title="添加翻译"
                    open={translationModalOpen}
                    onCancel={() => setTranslationModalOpen(false)}
                    onOk={handleAddTranslation}
                  >
                    <Form form={translationForm} layout="vertical">
                      <Form.Item name="locale" label="语言代码" rules={[{ required: true }]}>
                        <Select options={LOCALE_OPTIONS} />
                      </Form.Item>
                      <Form.Item name="name" label="翻译名称" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="aliases" label="别名">
                        <Input />
                      </Form.Item>
                      <Form.Item name="description" label="描述">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Form.Item name="servingDesc" label="份量描述">
                        <Input />
                      </Form.Item>
                    </Form>
                  </Modal>
                </>
              ),
            },
            {
              key: 'sources',
              label: (
                <>
                  <DatabaseOutlined /> 数据来源 ({sources?.length || 0})
                </>
              ),
              children: (
                <Table<FoodSourceDto>
                  dataSource={sources || []}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    {
                      title: '来源类型',
                      dataIndex: 'sourceType',
                      width: 120,
                      render: (v) => SOURCE_MAP[v as string] || v,
                    },
                    { title: '原始ID', dataIndex: 'sourceId', width: 120 },
                    {
                      title: '置信度',
                      dataIndex: 'confidence',
                      width: 80,
                      render: (v) => `${((v as number) * 100).toFixed(0)}%`,
                    },
                    { title: '优先级', dataIndex: 'priority', width: 80 },
                    {
                      title: '主数据源',
                      dataIndex: 'isPrimary',
                      width: 80,
                      render: (v) => (v ? <Tag color="green">是</Tag> : '否'),
                    },
                    { title: '抓取时间', dataIndex: 'fetchedAt', width: 160 },
                    {
                      title: '操作',
                      width: 80,
                      render: (_, record) => (
                        <Popconfirm
                          title="确认删除？"
                          onConfirm={() => handleDeleteSource(record.id)}
                        >
                          <Button type="link" size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'changeLogs',
              label: (
                <>
                  <HistoryOutlined /> 变更日志 ({changeLogs?.length || 0})
                </>
              ),
              children: (
                <Table<FoodChangeLogDto>
                  dataSource={changeLogs || []}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '版本', dataIndex: 'version', width: 60 },
                    {
                      title: '操作',
                      dataIndex: 'action',
                      width: 80,
                      render: (v) => (
                        <Tag color={ACTION_COLORS[v as string] || 'default'}>{v as string}</Tag>
                      ),
                    },
                    {
                      title: '变更内容',
                      dataIndex: 'changes',
                      render: (v) => (
                        <Typography.Text ellipsis style={{ maxWidth: 400 }}>
                          {JSON.stringify(v)}
                        </Typography.Text>
                      ),
                    },
                    { title: '操作人', dataIndex: 'operator', width: 100 },
                    { title: '原因', dataIndex: 'reason', width: 120 },
                    { title: '时间', dataIndex: 'createdAt', width: 160 },
                  ]}
                />
              ),
            },
            {
              key: 'conflicts',
              label: (
                <>
                  <WarningOutlined /> 数据冲突 ({food.conflicts?.length || 0})
                </>
              ),
              children: (
                <Table
                  dataSource={food.conflicts || []}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '冲突字段', dataIndex: 'field', width: 100 },
                    {
                      title: '来源数据',
                      dataIndex: 'sources',
                      render: (v: any[]) =>
                        v?.map((s, i) => (
                          <Tag key={i}>
                            {s.source}: {JSON.stringify(s.value)}
                          </Tag>
                        )),
                    },
                    {
                      title: '解决方式',
                      dataIndex: 'resolution',
                      width: 120,
                      render: (v) =>
                        v ? <Tag color="green">{v as string}</Tag> : <Tag color="red">待处理</Tag>,
                    },
                    { title: '采用值', dataIndex: 'resolvedValue', width: 100 },
                    { title: '处理人', dataIndex: 'resolvedBy', width: 100 },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default FoodDetailPage;
