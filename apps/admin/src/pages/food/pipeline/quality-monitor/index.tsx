import React from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Table,
  Tag,
  Typography,
  Spin,
  Space,
  Button,
  Descriptions,
} from 'antd';
import {
  CheckCircleOutlined,
  BarChartOutlined,
  SyncOutlined,
  WarningOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQualityReport } from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'quality-monitor',
  title: '数据质量',
  icon: 'DashboardOutlined',
  order: 6,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

const CATEGORY_LABELS: Record<string, string> = {
  protein: '蛋白质类',
  grain: '谷物主食',
  veggie: '蔬菜',
  fruit: '水果',
  dairy: '乳制品',
  fat: '油脂坚果',
  beverage: '饮品',
  snack: '零食甜点',
  condiment: '调味料',
  composite: '复合菜肴',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: '手工录入',
  usda: 'USDA',
  openfoodfacts: 'Open Food Facts',
  ai: 'AI生成',
  crawl: '爬虫',
};

const QualityMonitorPage: React.FC = () => {
  const { data: report, isLoading, refetch } = useQualityReport();

  if (isLoading) {
    return (
      <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />
    );
  }

  if (!report) {
    return (
      <Card>
        <Text type="secondary">暂无数据质量报告</Text>
      </Card>
    );
  }

  const { totalFoods, completeness, quality, conflicts, translations } = report;
  const total = totalFoods || 1;

  // 计算综合得分
  const completenessScore = completeness
    ? Math.round(
        ((completeness.withProtein +
          completeness.withMicronutrients +
          completeness.withAllergens +
          completeness.withImage +
          completeness.withCompatibility +
          completeness.withTags) /
          (total * 6)) *
          100
      )
    : 0;

  const qualityScore = quality
    ? Math.round(
        (quality.verified / total) * 40 +
          quality.avgConfidence * 30 +
          ((total - quality.macroInconsistent) / total) * 30
      )
    : 0;

  // 分类分布
  const categoryData = report.byCategory
    ? report.byCategory.map(({ category, count }) => ({
        category,
        label: CATEGORY_LABELS[category] || category,
        count,
        percent: ((count / total) * 100).toFixed(1),
      }))
    : [];

  // 来源分布
  const sourceData = report.bySource
    ? report.bySource.map(({ source, count }) => ({
        source,
        label: SOURCE_LABELS[source] || source,
        count,
        percent: ((count / total) * 100).toFixed(1),
      }))
    : [];

  // 状态分布
  const statusData = report.byStatus
    ? Object.entries(report.byStatus).map(([status, count]) => ({
        status,
        count: count as number,
      }))
    : [];

  return (
    <div>
      {/* 综合评分 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="数据总量" value={total} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 14 }}>
                完整度得分
              </Text>
              <Progress
                type="dashboard"
                percent={completenessScore}
                size={80}
                strokeColor={
                  completenessScore > 70
                    ? '#52c41a'
                    : completenessScore > 40
                      ? '#faad14'
                      : '#ff4d4f'
                }
              />
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 14 }}>
                质量得分
              </Text>
              <Progress
                type="dashboard"
                percent={qualityScore}
                size={80}
                strokeColor={
                  qualityScore > 70 ? '#52c41a' : qualityScore > 40 ? '#faad14' : '#ff4d4f'
                }
              />
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="宏量一致性"
              value={quality ? total - quality.macroInconsistent : 0}
              suffix={`/ ${total}`}
              prefix={<SafetyCertificateOutlined />}
              valueStyle={{
                color:
                  quality?.macroInconsistent !== undefined &&
                  (total - quality.macroInconsistent) / total > 0.8
                    ? '#3f8600'
                    : '#cf1322',
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 完整度详情 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <BarChartOutlined /> 字段完整度
              </Space>
            }
            extra={
              <Button size="small" icon={<SyncOutlined />} onClick={() => refetch()}>
                刷新
              </Button>
            }
          >
            {completeness && (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {[
                  { label: '宏量营养素', value: completeness.withProtein, color: '#1890ff' },
                  { label: '微量营养素', value: completeness.withMicronutrients, color: '#722ed1' },
                  { label: '过敏原信息', value: completeness.withAllergens, color: '#eb2f96' },
                  { label: '食物图片', value: completeness.withImage, color: '#fa8c16' },
                  { label: 'GI指数', value: completeness.withGI, color: '#13c2c2' },
                  { label: '餐次标签', value: completeness.withTags, color: '#52c41a' },
                  { label: '搭配关系', value: completeness.withCompatibility, color: '#2f54eb' },
                ].map((item) => {
                  const pct = Math.round((item.value / total) * 100);
                  return (
                    <div
                      key={item.label}
                      style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <Text style={{ width: 90, flexShrink: 0 }}>{item.label}</Text>
                      <Progress
                        percent={pct}
                        size="small"
                        style={{ flex: 1 }}
                        strokeColor={item.color}
                      />
                      <Text
                        type="secondary"
                        style={{ width: 70, textAlign: 'right', flexShrink: 0 }}
                      >
                        {item.value}/{total}
                      </Text>
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <CheckCircleOutlined /> 质量指标
              </Space>
            }
          >
            <Descriptions column={1} size="small">
              <Descriptions.Item label="已验证食物">
                <Space>
                  <Tag color="green">{quality?.verified || 0}</Tag>
                  <Text type="secondary">
                    ({(((quality?.verified || 0) / total) * 100).toFixed(1)}%)
                  </Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="平均置信度">
                <Progress
                  percent={Math.round((quality?.avgConfidence || 0) * 100)}
                  size="small"
                  status={
                    quality?.avgConfidence && quality.avgConfidence > 0.7 ? 'success' : 'exception'
                  }
                />
              </Descriptions.Item>
              <Descriptions.Item label="数据状态分布">
                <Space wrap>
                  {statusData.map((s) => (
                    <Tag
                      key={s.status}
                      color={
                        s.status === 'active'
                          ? 'green'
                          : s.status === 'draft'
                            ? 'default'
                            : 'orange'
                      }
                    >
                      {s.status}: {s.count}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="待处理冲突">
                <Tag
                  color={conflicts?.pending ? 'red' : 'green'}
                  icon={conflicts?.pending ? <WarningOutlined /> : <CheckCircleOutlined />}
                >
                  {conflicts?.pending || 0} 条待处理 / {conflicts?.total || 0} 条总计
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="翻译覆盖">
                <Space wrap>
                  {translations?.locales &&
                    translations.locales.map(({ locale, count }) => (
                      <Tag key={locale} color="purple">
                        {locale}: {count}
                      </Tag>
                    ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 分类和来源分布 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="分类分布">
            <Table
              dataSource={categoryData}
              columns={[
                { title: '分类', dataIndex: 'label', key: 'label' },
                {
                  title: '数量',
                  dataIndex: 'count',
                  key: 'count',
                  sorter: (a: any, b: any) => a.count - b.count,
                },
                {
                  title: '占比',
                  dataIndex: 'percent',
                  key: 'percent',
                  render: (v: string) => `${v}%`,
                },
              ]}
              rowKey="category"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="数据来源分布">
            <Table
              dataSource={sourceData}
              columns={[
                { title: '来源', dataIndex: 'label', key: 'label' },
                {
                  title: '数量',
                  dataIndex: 'count',
                  key: 'count',
                  sorter: (a: any, b: any) => a.count - b.count,
                },
                {
                  title: '占比',
                  dataIndex: 'percent',
                  key: 'percent',
                  render: (v: string) => `${v}%`,
                },
              ]}
              rowKey="source"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default QualityMonitorPage;
