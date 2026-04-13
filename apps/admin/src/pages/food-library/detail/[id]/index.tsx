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
  Progress,
  Tooltip,
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
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined,
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
import { useFoodCompleteness } from '@/services/foodPipelineService';
import { useQueryClient } from '@tanstack/react-query';
import {
  STATUS_MAP,
  SOURCE_MAP,
  CATEGORY_MAP,
  ACTION_COLORS,
  LOCALE_OPTIONS,
  ENRICHMENT_STATUS_MAP,
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
  const { data: changeLogs } = useFoodChangeLogs(id!);
  const { data: completeness } = useFoodCompleteness(id!, !!id);

  const [translationModalOpen, setTranslationModalOpen] = useState(false);
  const [translationForm] = Form.useForm();

  /** 渲染字段状态标签（已填/缺失 + 来源 + 置信度） */
  const fieldStatus = (value: any, fieldName?: string) => {
    const isFilled = value !== null && value !== undefined && value !== '' && value !== '-';
    // V8.0: 使用字段级来源和置信度
    const source = fieldName
      ? (food?.fieldSources as Record<string, string>)?.[fieldName]
      : undefined;
    const confidence = fieldName
      ? (food?.fieldConfidence as Record<string, number>)?.[fieldName]
      : undefined;

    if (!isFilled) {
      return (
        <Tooltip title="字段缺失，可通过AI补全">
          <MinusCircleOutlined style={{ color: '#ff4d4f', marginLeft: 4, fontSize: 12 }} />
        </Tooltip>
      );
    }
    // 字段级来源标记
    const sourceLabel =
      source === 'ai_enrichment' ? 'AI补全' : source === 'manual' ? '手动编辑' : source || '未知';
    const confidenceLabel =
      confidence !== undefined ? ` | 置信度 ${(confidence * 100).toFixed(0)}%` : '';

    if (source === 'ai_enrichment') {
      return (
        <Tooltip title={`${sourceLabel}${confidenceLabel}`}>
          <ThunderboltOutlined
            style={{
              color: confidence !== undefined && confidence < 0.7 ? '#faad14' : '#1677ff',
              marginLeft: 4,
              fontSize: 12,
            }}
          />
        </Tooltip>
      );
    }
    if (source === 'manual') {
      return (
        <Tooltip title={`${sourceLabel}${confidenceLabel}`}>
          <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 4, fontSize: 12 }} />
        </Tooltip>
      );
    }
    return <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 4, fontSize: 12 }} />;
  };

  /** 带状态标记的 Descriptions.Item 值渲染 */
  const fieldValue = (value: any, unit: string, fieldName: string) => (
    <span>
      {value ?? '-'} {value != null ? unit : ''}
      {fieldStatus(value, fieldName)}
    </span>
  );

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

      {/* V8.0: 数据完整度进度条 */}
      {completeness && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16} align="middle">
            <Col flex="none">
              <Typography.Text strong>数据完整度</Typography.Text>
            </Col>
            <Col flex="auto">
              <Progress
                percent={Number(completeness?.score.toFixed(1))}
                strokeColor={
                  completeness?.score >= 80
                    ? '#52c41a'
                    : completeness?.score >= 50
                      ? '#faad14'
                      : '#ff4d4f'
                }
                format={(pct) => `${pct}%`}
              />
            </Col>
            <Col flex="none">
              <Space size={4}>
                <Tooltip title="已填写字段">
                  <Tag color="green" icon={<CheckCircleOutlined />}>
                    {completeness.filledFields?.length} 已填
                  </Tag>
                </Tooltip>
                <Tooltip
                  title={
                    completeness.missingFields?.length > 0
                      ? `缺失: ${completeness.missingFields?.slice(0, 10).join(', ')}${completeness.missingFields.length > 10 ? '...' : ''}`
                      : '无缺失'
                  }
                >
                  <Tag
                    color={completeness.missingFields?.length > 0 ? 'red' : 'default'}
                    icon={
                      completeness.missingFields?.length > 0 ? (
                        <ExclamationCircleOutlined />
                      ) : undefined
                    }
                  >
                    {completeness.missingFields?.length} 缺失
                  </Tag>
                </Tooltip>
                <Tag>{completeness.totalFields} 总字段</Tag>
              </Space>
            </Col>
          </Row>
        </Card>
      )}

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
                    <Descriptions.Item label="蛋白质">
                      {fieldValue(food.protein, 'g', 'protein')}
                    </Descriptions.Item>
                    <Descriptions.Item label="脂肪">
                      {fieldValue(food.fat, 'g', 'fat')}
                    </Descriptions.Item>
                    <Descriptions.Item label="碳水">
                      {fieldValue(food.carbs, 'g', 'carbs')}
                    </Descriptions.Item>
                    <Descriptions.Item label="膳食纤维">
                      {fieldValue(food.fiber, 'g', 'fiber')}
                    </Descriptions.Item>
                    <Descriptions.Item label="糖">
                      {fieldValue(food.sugar, 'g', 'sugar')}
                    </Descriptions.Item>
                    <Descriptions.Item label="饱和脂肪">
                      {fieldValue(food.saturatedFat, 'g', 'saturated_fat')}
                    </Descriptions.Item>
                    <Descriptions.Item label="反式脂肪">
                      {fieldValue(food.transFat, 'g', 'trans_fat')}
                    </Descriptions.Item>
                    <Descriptions.Item label="胆固醇">
                      {fieldValue(food.cholesterol, 'mg', 'cholesterol')}
                    </Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    微量营养素 (per 100g)
                  </Typography.Title>
                  <Descriptions bordered column={4} size="small">
                    <Descriptions.Item label="钠">
                      {fieldValue(food.sodium, 'mg', 'sodium')}
                    </Descriptions.Item>
                    <Descriptions.Item label="钾">
                      {fieldValue(food.potassium, 'mg', 'potassium')}
                    </Descriptions.Item>
                    <Descriptions.Item label="钙">
                      {fieldValue(food.calcium, 'mg', 'calcium')}
                    </Descriptions.Item>
                    <Descriptions.Item label="铁">
                      {fieldValue(food.iron, 'mg', 'iron')}
                    </Descriptions.Item>
                    <Descriptions.Item label="锌">
                      {fieldValue(food.zinc, 'mg', 'zinc')}
                    </Descriptions.Item>
                    <Descriptions.Item label="镁">
                      {fieldValue(food.magnesium, 'mg', 'magnesium')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素A">
                      {fieldValue(food.vitaminA, 'μg', 'vitamin_a')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素C">
                      {fieldValue(food.vitaminC, 'mg', 'vitamin_c')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素D">
                      {fieldValue(food.vitaminD, 'μg', 'vitamin_d')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素E">
                      {fieldValue(food.vitaminE, 'mg', 'vitamin_e')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素B12">
                      {fieldValue(food.vitaminB12, 'μg', 'vitamin_b12')}
                    </Descriptions.Item>
                    <Descriptions.Item label="叶酸">
                      {fieldValue(food.folate, 'μg', 'folate')}
                    </Descriptions.Item>
                    <Descriptions.Item label="磷">
                      {fieldValue(food.phosphorus, 'mg', 'phosphorus')}
                    </Descriptions.Item>
                    <Descriptions.Item label="嘌呤">
                      {fieldValue(food.purine, 'mg', 'purine')}
                    </Descriptions.Item>
                    <Descriptions.Item label="维生素B6">
                      {fieldValue(food.vitaminB6, 'mg', 'vitamin_b6')}
                    </Descriptions.Item>
                    <Descriptions.Item label="Omega-3">
                      {fieldValue(food.omega3, 'mg', 'omega3')}
                    </Descriptions.Item>
                    <Descriptions.Item label="Omega-6">
                      {fieldValue(food.omega6, 'mg', 'omega6')}
                    </Descriptions.Item>
                    <Descriptions.Item label="可溶性纤维">
                      {fieldValue(food.solubleFiber, 'g', 'soluble_fiber')}
                    </Descriptions.Item>
                    <Descriptions.Item label="不溶性纤维">
                      {fieldValue(food.insolubleFiber, 'g', 'insoluble_fiber')}
                    </Descriptions.Item>
                    <Descriptions.Item label="含水率">
                      {fieldValue(food.waterContentPercent, '%', 'water_content_percent')}
                    </Descriptions.Item>
                  </Descriptions>

                  <Typography.Title level={5} style={{ marginTop: 24 }}>
                    健康评估 & 决策引擎
                  </Typography.Title>
                  <Descriptions bordered column={4} size="small">
                    <Descriptions.Item label="GI值">
                      {fieldValue(food.glycemicIndex, '', 'glycemic_index')}
                    </Descriptions.Item>
                    <Descriptions.Item label="GL值">
                      {fieldValue(food.glycemicLoad, '', 'glycemic_load')}
                    </Descriptions.Item>
                    <Descriptions.Item label="品质评分">
                      {fieldValue(food.qualityScore, '', 'quality_score')}
                    </Descriptions.Item>
                    <Descriptions.Item label="饱腹感">
                      {fieldValue(food.satietyScore, '', 'satiety_score')}
                    </Descriptions.Item>
                    <Descriptions.Item label="营养密度">
                      {fieldValue(food.nutrientDensity, '', 'nutrient_density')}
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
                    {/* V8.0: 补全元数据 */}
                    <Descriptions.Item label="数据完整度">
                      {food.dataCompleteness != null ? (
                        <Progress
                          percent={Number((food.dataCompleteness * 100).toFixed(1))}
                          size="small"
                          strokeColor={
                            food.dataCompleteness >= 0.8
                              ? '#52c41a'
                              : food.dataCompleteness >= 0.5
                                ? '#faad14'
                                : '#ff4d4f'
                          }
                          style={{ width: 120, display: 'inline-flex' }}
                        />
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="补全状态">
                      {food.enrichmentStatus ? (
                        <Tag
                          color={ENRICHMENT_STATUS_MAP[food.enrichmentStatus]?.color || 'default'}
                        >
                          {ENRICHMENT_STATUS_MAP[food.enrichmentStatus]?.text ||
                            food.enrichmentStatus}
                        </Tag>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="最后补全时间">
                      {food.lastEnrichedAt || '-'}
                    </Descriptions.Item>
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
                  <HistoryOutlined /> 变更日志 ({changeLogs?.total || 0})
                </>
              ),
              children: (
                <Table<FoodChangeLogDto>
                  dataSource={changeLogs?.list || []}
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
