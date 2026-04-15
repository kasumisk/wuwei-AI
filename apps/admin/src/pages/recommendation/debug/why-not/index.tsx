import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Row,
  Col,
  Tag,
  Spin,
  Empty,
  Alert,
  Space,
  Table,
  Descriptions,
  Typography,
  Result,
} from 'antd';
import {
  QuestionCircleOutlined,
  SearchOutlined,
  UserOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useWhyNot, type WhyNotResult } from '@/services/recommendDebugService';

const { Text } = Typography;

export const routeConfig = {
  name: 'recommend-why-not',
  title: '反向解释',
  icon: 'QuestionCircleOutlined',
  order: 2,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const mealTypeOptions = [
  { label: '早餐 (breakfast)', value: 'breakfast' },
  { label: '午餐 (lunch)', value: 'lunch' },
  { label: '晚餐 (dinner)', value: 'dinner' },
  { label: '加餐 (snack)', value: 'snack' },
];

const goalTypeOptions = [
  { label: '使用用户档案默认', value: '' },
  { label: '减脂 (fat_loss)', value: 'fat_loss' },
  { label: '增肌 (muscle_gain)', value: 'muscle_gain' },
  { label: '健康 (health)', value: 'health' },
  { label: '习惯养成 (habit)', value: 'habit' },
];

// ==================== 替代食物表列 ====================

interface Alternative {
  foodId: string;
  name: string;
  category: string;
  score: number;
  servingCalories: number;
  servingProtein: number;
}

const alternativeColumns: ColumnsType<Alternative> = [
  {
    title: '食物名称',
    dataIndex: 'name',
    width: 180,
    render: (name: string) => <Text strong>{name}</Text>,
  },
  {
    title: '分类',
    dataIndex: 'category',
    width: 120,
    render: (cat: string) => <Tag color="blue">{cat}</Tag>,
  },
  {
    title: '评分',
    dataIndex: 'score',
    width: 100,
    sorter: (a, b) => a.score - b.score,
    render: (score: number) => (
      <Tag color={score >= 0.7 ? 'success' : score >= 0.4 ? 'warning' : 'default'}>
        {score.toFixed(3)}
      </Tag>
    ),
  },
  {
    title: '每份热量',
    dataIndex: 'servingCalories',
    width: 100,
    render: (val: number) => `${val} kcal`,
  },
  {
    title: '每份蛋白质',
    dataIndex: 'servingProtein',
    width: 100,
    render: (val: number) => `${val} g`,
  },
  {
    title: 'Food ID',
    dataIndex: 'foodId',
    width: 200,
    ellipsis: true,
    render: (id: string) => (
      <Text copyable style={{ fontSize: 12 }}>
        {id}
      </Text>
    ),
  },
];

// ==================== 结果展示 ====================

const WhyNotResultDisplay: React.FC<{ result: WhyNotResult }> = ({ result }) => {
  return (
    <div>
      {/* 查询结果概要 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Result
          icon={
            result.found ? (
              <CheckCircleFilled style={{ color: '#52c41a' }} />
            ) : (
              <CloseCircleFilled style={{ color: '#ff4d4f' }} />
            )
          }
          title={result.found ? '该食物已在推荐候选池中' : '该食物未出现在推荐结果中'}
          subTitle={result.reason}
          style={{ padding: '16px 0' }}
        />
      </Card>

      {/* 详情 */}
      <Card title="查询详情" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="查询食物">{result.queryFoodName}</Descriptions.Item>
          <Descriptions.Item label="匹配食物">{result.foodName || '-'}</Descriptions.Item>
          <Descriptions.Item label="用户 ID">
            <Text copyable>{result.userId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="餐次">
            <Tag color="green">{result.mealType}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="目标类型">
            <Tag color="blue">{result.goalType}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="评分">
            <Tag color={result.score >= 0.5 ? 'success' : result.score > 0 ? 'warning' : 'error'}>
              {result.score.toFixed(4)}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 替代食物 */}
      {result.alternatives && result.alternatives.length > 0 && (
        <Card title={`替代食物推荐 (${result.alternatives.length} 个)`} size="small">
          <Table
            columns={alternativeColumns}
            dataSource={result.alternatives}
            rowKey="foodId"
            size="small"
            pagination={false}
          />
        </Card>
      )}
    </div>
  );
};

// ==================== 主组件 ====================

const WhyNotPage: React.FC = () => {
  const [form] = Form.useForm();
  const [resultData, setResultData] = useState<WhyNotResult | null>(null);

  const mutation = useWhyNot({
    onSuccess: (data) => setResultData(data),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setResultData(null);
      mutation.mutate({
        userId: values.userId,
        foodName: values.foodName,
        mealType: values.mealType,
        goalType: values.goalType || undefined,
      });
    } catch {
      // validation error
    }
  };

  return (
    <div>
      {/* 输入表单 */}
      <Card
        title={
          <Space>
            <QuestionCircleOutlined />
            <span>反向解释：为什么不推荐某食物</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="输入用户 ID 和食物名称，查询该食物为什么没有出现在推荐列表中，并获取替代建议"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="userId"
                label="用户 ID"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="用户 UUID" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="foodName"
                label="食物名称"
                rules={[{ required: true, message: '请输入食物名称' }]}
              >
                <Input prefix={<SearchOutlined />} placeholder="例: 鸡胸肉、燕麦" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item
                name="mealType"
                label="餐次类型"
                rules={[{ required: true, message: '请选择餐次' }]}
              >
                <Select placeholder="选择餐次" options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="goalType" label="目标类型">
                <Select placeholder="默认" allowClear options={goalTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={3} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleSubmit}
                  loading={mutation.isPending}
                  block
                  size="large"
                >
                  查询
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 结果展示 */}
      {mutation.isPending && (
        <Card>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" tip="正在分析..." />
          </div>
        </Card>
      )}

      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          message="查询失败"
          description={mutation.error?.message || '请检查参数是否正确'}
          style={{ marginBottom: 16 }}
        />
      )}

      {resultData && <WhyNotResultDisplay result={resultData} />}

      {!mutation.isPending && !resultData && !mutation.isError && (
        <Card>
          <Empty description="输入参数并点击「查询」查看分析结果" />
        </Card>
      )}
    </div>
  );
};

export default WhyNotPage;
