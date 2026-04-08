import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Form,
  Select,
  InputNumber,
  Switch,
  Typography,
  Alert,
  Descriptions,
  Tag,
  Divider,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  RobotOutlined,
  CalculatorOutlined,
  TagOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import {
  useBatchAiLabel,
  useBatchApplyRules,
  useQualityReport,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'ai-label',
  title: 'AI 标注',
  icon: 'RobotOutlined',
  order: 3,
  requireAuth: true,
  hideInMenu: false,
};

const { Title, Text } = Typography;

const CATEGORY_OPTIONS = [
  { label: '全部分类', value: '' },
  { label: '蛋白质类', value: 'protein' },
  { label: '谷物主食', value: 'grain' },
  { label: '蔬菜', value: 'veggie' },
  { label: '水果', value: 'fruit' },
  { label: '乳制品', value: 'dairy' },
  { label: '油脂坚果', value: 'fat' },
  { label: '饮品', value: 'beverage' },
  { label: '零食甜点', value: 'snack' },
  { label: '调味料', value: 'condiment' },
  { label: '复合菜肴', value: 'composite' },
];

const AiLabelPage: React.FC = () => {
  const [labelForm] = Form.useForm();
  const [rulesForm] = Form.useForm();
  const [labelResult, setLabelResult] = useState<{ labeled: number; failed: number } | null>(null);
  const [rulesResult, setRulesResult] = useState<{ processed: number } | null>(null);
  const { data: report } = useQualityReport();

  const batchLabel = useBatchAiLabel({
    onSuccess: (result) => {
      setLabelResult(result);
      message.success(`AI 标注完成: 成功 ${result.labeled}, 失败 ${result.failed}`);
    },
    onError: (e) => message.error(`标注失败: ${e.message}`),
  });

  const batchRules = useBatchApplyRules({
    onSuccess: (result) => {
      setRulesResult(result);
      message.success(`规则计算完成: 处理了 ${result.processed} 条`);
    },
    onError: (e) => message.error(`规则计算失败: ${e.message}`),
  });

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card>
            <Statistic
              title="食物总数"
              value={report?.summary?.totalFoods || 0}
              prefix={<TagOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Statistic
              title="已验证"
              value={report?.quality?.verifiedCount || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      {/* AI 智能标注 */}
      <Card
        title={<Space><RobotOutlined /> AI 智能标注（DeepSeek V3）</Space>}
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="AI 标注功能"
          description="使用 DeepSeek V3 大语言模型自动标注食物的分类、标签、加工级别、餐次类型、过敏原和搭配关系。标注完成后会自动重新计算品质评分、饱腹感评分和营养密度。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={labelForm}
          layout="inline"
          initialValues={{ limit: 50, unlabeled: true }}
          onFinish={(values) => {
            const data = { ...values };
            if (!data.category) delete data.category;
            batchLabel.mutate(data);
          }}
          style={{ flexWrap: 'wrap', gap: 8 }}
        >
          <Form.Item name="category" label="分类">
            <Select options={CATEGORY_OPTIONS} style={{ width: 160 }} allowClear />
          </Form.Item>
          <Form.Item name="unlabeled" label="仅未标注" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="limit" label="数量">
            <InputNumber min={1} max={500} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<RobotOutlined />} loading={batchLabel.isPending}>
              开始 AI 标注
            </Button>
          </Form.Item>
        </Form>

        {labelResult && (
          <div style={{ marginTop: 16 }}>
            <Divider />
            <Descriptions title="标注结果" column={3} size="small">
              <Descriptions.Item label="成功标注">
                <Tag color="green">{labelResult.labeled}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="标注失败">
                <Tag color="red">{labelResult.failed}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="成功率">
                <Tag color="blue">
                  {labelResult.labeled + labelResult.failed > 0
                    ? ((labelResult.labeled / (labelResult.labeled + labelResult.failed)) * 100).toFixed(1)
                    : 0}%
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Card>

      {/* 规则引擎计算 */}
      <Card title={<Space><CalculatorOutlined /> 规则引擎（评分与标签计算）</Space>}>
        <Alert
          message="规则引擎功能"
          description="基于营养数据自动计算：品质评分(qualityScore)、饱腹感评分(satietyScore)、NRF9.3营养密度(nutrientDensity)，以及自动生成标签（high_protein, low_fat, keto, vegan 等）。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={rulesForm}
          layout="inline"
          initialValues={{ limit: 500, recalcAll: false }}
          onFinish={(values) => batchRules.mutate(values)}
        >
          <Form.Item name="recalcAll" label="全量重算" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="limit" label="数量">
            <InputNumber min={1} max={5000} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<CalculatorOutlined />} loading={batchRules.isPending}>
              开始计算
            </Button>
          </Form.Item>
        </Form>

        {rulesResult && (
          <div style={{ marginTop: 16 }}>
            <Divider />
            <Descriptions title="计算结果" column={1} size="small">
              <Descriptions.Item label="已处理">
                <Tag color="green">{rulesResult.processed} 条食物</Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AiLabelPage;
