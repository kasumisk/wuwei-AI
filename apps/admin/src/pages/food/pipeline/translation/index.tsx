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
  Alert,
  Descriptions,
  Tag,
  Divider,
  Table,
  Row,
  Col,
  Statistic,
} from 'antd';
import { TranslationOutlined, GlobalOutlined } from '@ant-design/icons';
import { useBatchAiTranslate, useQualityReport } from '@/services/foodPipelineService';
import { LOCALE_OPTIONS } from '@/pages/food/library/constants';

export const routeConfig = {
  name: 'translation',
  title: '翻译管理',
  icon: 'TranslationOutlined',
  order: 4,
  requireAuth: true,
  hideInMenu: false,
};

const TranslationPage: React.FC = () => {
  const [form] = Form.useForm();
  const [result, setResult] = useState<{ translated: number; failed: number } | null>(null);
  const { data: report } = useQualityReport();

  const batchTranslate = useBatchAiTranslate({
    onSuccess: (res) => {
      setResult(res);
      message.success(`翻译完成: 成功 ${res.translated}, 失败 ${res.failed}`);
    },
    onError: (e) => message.error(`翻译失败: ${e.message}`),
  });

  const translationStats = report?.translations;
  const localeColumns = [
    {
      title: '语言',
      dataIndex: 'locale',
      key: 'locale',
      render: (v: string) => {
        const opt = LOCALE_OPTIONS.find((o) => o.value === v);
        return <Tag color="purple">{opt?.label || v}</Tag>;
      },
    },
    { title: '已翻译数量', dataIndex: 'count', key: 'count' },
    {
      title: '覆盖率',
      dataIndex: 'coverage',
      key: 'coverage',
      render: (v: number) => (
        <Tag color={v > 80 ? 'green' : v > 50 ? 'orange' : 'red'}>{v.toFixed(1)}%</Tag>
      ),
    },
  ];

  const localeData = translationStats?.locales
    ? translationStats.locales.map(({ locale, count }) => ({
        locale,
        count,
        coverage: report?.totalFoods ? (count / report.totalFoods) * 100 : 0,
      }))
    : [];

  return (
    <div>
      {/* 翻译概况 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="总翻译条目"
              value={translationStats?.foodsWithTranslation || 0}
              prefix={<GlobalOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="未翻译食物"
              value={translationStats?.foodsWithoutTranslation || 0}
              valueStyle={{
                color: translationStats?.foodsWithoutTranslation ? '#cf1322' : '#3f8600',
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="支持语言数"
              value={localeData.length}
              prefix={<TranslationOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 各语言覆盖情况 */}
      {localeData.length > 0 && (
        <Card title="各语言翻译覆盖" style={{ marginBottom: 16 }}>
          <Table
            dataSource={localeData}
            columns={localeColumns}
            rowKey="locale"
            pagination={false}
            size="small"
          />
        </Card>
      )}

      {/* 批量翻译 */}
      <Card
        title={
          <Space>
            <TranslationOutlined /> AI 批量翻译（DeepSeek V3）
          </Space>
        }
      >
        <Alert
          message="AI 翻译功能"
          description="使用 DeepSeek V3 大语言模型将食物名称、别名、描述和份量描述翻译为目标语言。翻译结果存储到 food_translations 表，支持多语言 App 展示。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ targetLocales: ['en-US'], limit: 50, untranslatedOnly: true }}
          onFinish={(values) => batchTranslate.mutate(values)}
          style={{ maxWidth: 600 }}
        >
          <Form.Item
            name="targetLocales"
            label="目标语言"
            rules={[{ required: true, message: '请选择至少一个目标语言' }]}
          >
            <Select mode="multiple" options={LOCALE_OPTIONS} maxTagCount={3} />
          </Form.Item>
          <Form.Item name="untranslatedOnly" label="仅处理未翻译的" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<TranslationOutlined />}
              loading={batchTranslate.isPending}
              size="large"
            >
              开始批量翻译
            </Button>
          </Form.Item>
        </Form>

        {result && (
          <div style={{ marginTop: 16 }}>
            <Divider />
            <Descriptions title="翻译结果" column={3} size="small">
              <Descriptions.Item label="成功翻译">
                <Tag color="green">{result.translated}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="翻译失败">
                <Tag color="red">{result.failed}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="成功率">
                <Tag color="blue">
                  {result.translated + result.failed > 0
                    ? ((result.translated / (result.translated + result.failed)) * 100).toFixed(1)
                    : 0}
                  %
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Card>
    </div>
  );
};

export default TranslationPage;
