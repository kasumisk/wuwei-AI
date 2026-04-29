import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  InputNumber,
  Row,
  Space,
  Statistic,
  Switch,
  Tag,
  message,
} from 'antd';
import {
  CalculatorOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  useBackfillNutrientScores,
  useBatchApplyRules,
  useQualityReport,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'scoring',
  title: '评分与回填',
  icon: 'CalculatorOutlined',
  order: 5,
  requireAuth: true,
  hideInMenu: false,
};

const ScoringPage: React.FC = () => {
  const [rulesForm] = Form.useForm();
  const [backfillForm] = Form.useForm();
  const [rulesResult, setRulesResult] = useState<{ processed: number } | null>(null);
  const [backfillResult, setBackfillResult] = useState<{
    total: number;
    updated: number;
    errors: number;
  } | null>(null);
  const { data: report, refetch } = useQualityReport();

  const batchRules = useBatchApplyRules({
    onSuccess: (result) => {
      setRulesResult(result);
      message.success(`规则计算完成: 处理了 ${result.processed} 条`);
      refetch();
    },
    onError: (e) => message.error(`规则计算失败: ${e.message}`),
  });

  const backfillScores = useBackfillNutrientScores({
    onSuccess: (result) => {
      setBackfillResult(result);
      message.success(`评分回填完成: 更新 ${result.updated}/${result.total}, 错误 ${result.errors}`);
      refetch();
    },
    onError: (e) => message.error(`评分回填失败: ${e.message}`),
  });

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card>
            <Statistic title="食物总数" value={report?.totalFoods || 0} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Statistic
              title="已验证"
              value={report?.quality?.verified || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <CalculatorOutlined /> 规则计算
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="什么时候用"
          description="新导入或新标注的食物，需要重新生成 qualityScore、satietyScore、nutrientDensity 和规则标签时。"
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
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={5000} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<CalculatorOutlined />}
              loading={batchRules.isPending}
            >
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

      <Card
        title={
          <Space>
            <ReloadOutlined /> 历史评分回填
          </Space>
        }
      >
        <Alert
          message="什么时候用"
          description="历史数据缺少 health assessment，或者迁移后老记录还没有 qualityScore / satietyScore / nutrientDensity 时。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={backfillForm}
          layout="inline"
          initialValues={{ batchSize: 200 }}
          onFinish={(values) => backfillScores.mutate(values)}
        >
          <Form.Item name="batchSize" label="批次大小">
            <InputNumber min={1} max={2000} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<ReloadOutlined />}
              loading={backfillScores.isPending}
            >
              开始回填
            </Button>
          </Form.Item>
        </Form>

        {backfillResult && (
          <div style={{ marginTop: 16 }}>
            <Divider />
            <Descriptions title="回填结果" column={3} size="small">
              <Descriptions.Item label="需处理总数">
                <Tag>{backfillResult.total}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="成功更新">
                <Tag color="green">{backfillResult.updated}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="错误数">
                <Tag color={backfillResult.errors > 0 ? 'red' : 'blue'}>
                  {backfillResult.errors}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ScoringPage;
