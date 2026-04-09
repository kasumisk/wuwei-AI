import React, { useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Row,
  Col,
  Typography,
  Spin,
  Divider,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useFoodDetail, useCreateFood, useUpdateFood } from '@/services/foodLibraryService';
import { FOOD_CATEGORIES, STATUS_MAP, SOURCE_MAP, MEAL_TYPE_OPTIONS } from '../../constants';

export const routeConfig = {
  name: 'food-edit',
  title: '编辑食物',
  icon: 'EditOutlined',
  order: 13,
  requireAuth: true,
  hideInMenu: true,
};

const FoodEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const { data: food, isLoading } = useFoodDetail(id!, isEditing);

  const createMutation = useCreateFood({
    onSuccess: (data) => {
      message.success('创建成功');
      navigate(`/food-library/detail/${data.id}`);
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });

  const updateMutation = useUpdateFood({
    onSuccess: () => {
      message.success('更新成功');
      navigate(`/food-library/detail/${id}`);
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });

  useEffect(() => {
    if (food && isEditing) {
      form.setFieldsValue(food);
    }
  }, [food, isEditing, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (isEditing) {
      updateMutation.mutate({ id: id!, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  if (isEditing && isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() =>
                  isEditing
                    ? navigate(`/food-library/detail/${id}`)
                    : navigate('/food-library/list')
                }
              >
                返回
              </Button>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {isEditing ? `编辑食物 - ${food?.name || ''}` : '新增食物'}
              </Typography.Title>
            </Space>
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              保存
            </Button>
          </Col>
        </Row>
      </Card>

      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            status: 'active',
            processingLevel: 1,
            isProcessed: false,
            isFried: false,
            isVerified: false,
            primarySource: 'manual',
            confidence: 0.8,
            standardServingG: 100,
            searchWeight: 50,
          }}
        >
          <Typography.Title level={5}>基础信息</Typography.Title>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="code"
                label="食物编码"
                rules={[{ required: !isEditing, message: '请输入编码' }]}
              >
                <Input placeholder="如: FOOD_CN_0001" disabled={isEditing} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="category"
                label="分类"
                rules={[{ required: true, message: '请选择分类' }]}
              >
                <Select options={[...FOOD_CATEGORIES]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="aliases" label="别名（逗号分隔）">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="barcode" label="条形码">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select
                  options={Object.entries(STATUS_MAP).map(([k, v]) => ({
                    label: v.text,
                    value: k,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="subCategory" label="二级分类">
                <Input placeholder="如: lean_meat" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="foodGroup" label="多样性分组">
                <Input placeholder="如: poultry" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mainIngredient" label="主要食材">
                <Input placeholder="如: chicken" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Typography.Title level={5}>宏量营养素 (per 100g)</Typography.Title>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="calories" label="热量(kcal)" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="protein" label="蛋白质(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="fat" label="脂肪(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="carbs" label="碳水(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="fiber" label="膳食纤维(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="sugar" label="糖(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="saturatedFat" label="饱和脂肪(g)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="transFat" label="反式脂肪(g)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="cholesterol" label="胆固醇(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Typography.Title level={5}>微量营养素 (per 100g)</Typography.Title>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="sodium" label="钠(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="potassium" label="钾(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="calcium" label="钙(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="iron" label="铁(mg)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="zinc" label="锌(mg)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="magnesium" label="镁(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vitaminA" label="维生素A(μg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vitaminC" label="维生素C(mg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="vitaminD" label="维生素D(μg)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vitaminE" label="维生素E(mg)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vitaminB12" label="维生素B12(μg)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="folate" label="叶酸(μg)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Typography.Title level={5}>健康评估 & 决策引擎</Typography.Title>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="glycemicIndex" label="GI值">
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="glycemicLoad" label="GL值">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="processingLevel" label="NOVA分级(1-4)">
                <InputNumber min={1} max={4} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="qualityScore" label="品质评分(1-10)">
                <InputNumber min={1} max={10} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="satietyScore" label="饱腹感(1-10)">
                <InputNumber min={1} max={10} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="nutrientDensity" label="营养密度">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="standardServingG" label="标准份量(g)">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="searchWeight" label="搜索权重">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="standardServingDesc" label="份量描述">
                <Input placeholder="如: 1碗约200g" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mealTypes" label="适合餐次">
                <Select mode="multiple" options={MEAL_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Typography.Title level={5}>媒体 & 属性</Typography.Title>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="imageUrl" label="食物图片URL">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="thumbnailUrl" label="缩略图URL">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="primarySource" label="数据来源">
                <Select
                  options={Object.entries(SOURCE_MAP).map(([k, v]) => ({ label: v, value: k }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={4}>
              <Form.Item name="isVerified" label="已验证" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="isProcessed" label="加工食品" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="isFried" label="油炸食品" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>
    </div>
  );
};

export default FoodEditPage;
