import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Row,
  Col,
  Descriptions,
  Tag,
  Spin,
  Empty,
  Alert,
  Space,
  Divider,
  Typography,
} from 'antd';
import {
  PlayCircleOutlined,
  ClockCircleOutlined,
  UserOutlined,
  AimOutlined,
} from '@ant-design/icons';
import {
  useSimulateRecommend,
  type SimulateRecommendResult,
} from '@/services/recommendDebugService';

const { Text, Title } = Typography;

export const routeConfig = {
  name: 'recommend-simulate',
  title: '模拟推荐',
  icon: 'PlayCircleOutlined',
  order: 1,
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

// ==================== 结果展示组件 ====================

const ResultDisplay: React.FC<{ result: SimulateRecommendResult }> = ({ result }) => {
  const { input, performance, note } = result;

  return (
    <div>
      {/* 性能指标 */}
      <Alert
        type="info"
        showIcon
        icon={<ClockCircleOutlined />}
        message={
          <Space size="large">
            <span>
              耗时: <Text strong>{performance.elapsedMs}ms</Text>
            </span>
            <span>
              目标类型: <Tag color="blue">{result.goalType}</Tag>
            </span>
            <span>
              餐次: <Tag color="green">{result.mealType}</Tag>
            </span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      {note && <Alert message={note} type="warning" showIcon style={{ marginBottom: 16 }} />}

      {/* 用户输入上下文 */}
      <Card title="推荐输入上下文" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="已摄入热量">
                {input.consumed.calories} kcal
              </Descriptions.Item>
              <Descriptions.Item label="已摄入蛋白质">{input.consumed.protein} g</Descriptions.Item>
              <Descriptions.Item label="每日热量目标">
                {input.dailyTarget.calories} kcal
              </Descriptions.Item>
              <Descriptions.Item label="每日蛋白质目标">
                {input.dailyTarget.protein} g
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={12}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="餐次热量目标">
                {input.target.calories} kcal
              </Descriptions.Item>
              <Descriptions.Item label="餐次蛋白质">{input.target.protein} g</Descriptions.Item>
              <Descriptions.Item label="餐次脂肪">{input.target.fat} g</Descriptions.Item>
              <Descriptions.Item label="餐次碳水">{input.target.carbs} g</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
        {input.userProfile && (
          <div style={{ marginTop: 12 }}>
            <Space wrap>
              {input.userProfile.allergens?.length > 0 && (
                <span>
                  过敏原:{' '}
                  {input.userProfile.allergens.map((a) => (
                    <Tag key={a} color="red">
                      {a}
                    </Tag>
                  ))}
                </span>
              )}
              {input.userProfile.dietaryRestrictions?.length > 0 && (
                <span>
                  饮食限制:{' '}
                  {input.userProfile.dietaryRestrictions.map((d) => (
                    <Tag key={d} color="orange">
                      {d}
                    </Tag>
                  ))}
                </span>
              )}
              {input.userProfile.healthConditions?.length > 0 && (
                <span>
                  健康状况:{' '}
                  {input.userProfile.healthConditions.map((h) => (
                    <Tag key={h} color="purple">
                      {h}
                    </Tag>
                  ))}
                </span>
              )}
              {input.userProfile.regionCode && (
                <span>
                  地区: <Tag>{input.userProfile.regionCode}</Tag>
                </span>
              )}
            </Space>
          </div>
        )}
      </Card>

      {/* 推荐结果 JSON */}
      <Card title="推荐结果" size="small">
        <pre
          style={{
            background: '#f5f5f5',
            padding: 16,
            borderRadius: 6,
            maxHeight: 600,
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {JSON.stringify(result.result, null, 2)}
        </pre>
      </Card>
    </div>
  );
};

// ==================== 主组件 ====================

const SimulatePage: React.FC = () => {
  const [form] = Form.useForm();
  const [resultData, setResultData] = useState<SimulateRecommendResult | null>(null);

  const mutation = useSimulateRecommend({
    onSuccess: (data) => setResultData(data),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setResultData(null);
      mutation.mutate({
        userId: values.userId,
        mealType: values.mealType,
        goalType: values.goalType || undefined,
        consumedCalories: values.consumedCalories ?? undefined,
        consumedProtein: values.consumedProtein ?? undefined,
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
            <PlayCircleOutlined />
            <span>模拟推荐</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="模拟推荐为只读操作，不会产生任何副作用（不保存记录、不影响用户数据）"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="userId"
                label="用户 ID"
                rules={[{ required: true, message: '请输入用户 ID' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="输入用户 UUID" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="mealType"
                label="餐次类型"
                rules={[{ required: true, message: '请选择餐次类型' }]}
              >
                <Select placeholder="选择餐次" options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="goalType" label="目标类型覆盖">
                <Select placeholder="使用用户档案默认" allowClear options={goalTypeOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="consumedCalories" label="已摄入热量 (kcal)">
                <InputNumber min={0} max={10000} style={{ width: '100%' }} placeholder="默认 0" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="consumedProtein" label="已摄入蛋白质 (g)">
                <InputNumber min={0} max={1000} style={{ width: '100%' }} placeholder="默认 0" />
              </Form.Item>
            </Col>
            <Col span={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleSubmit}
                  loading={mutation.isPending}
                  block
                  size="large"
                >
                  执行模拟推荐
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
            <Spin size="large" tip="正在执行推荐引擎..." />
          </div>
        </Card>
      )}

      {mutation.isError && (
        <Alert
          type="error"
          showIcon
          message="模拟推荐失败"
          description={mutation.error?.message || '请检查用户 ID 是否有效'}
          style={{ marginBottom: 16 }}
        />
      )}

      {resultData && <ResultDisplay result={resultData} />}

      {!mutation.isPending && !resultData && !mutation.isError && (
        <Card>
          <Empty description="输入参数并点击「执行模拟推荐」查看结果" />
        </Card>
      )}
    </div>
  );
};

export default SimulatePage;
