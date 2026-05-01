import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AlertOutlined,
  AppstoreOutlined,
  CrownOutlined,
  DollarOutlined,
  FundOutlined,
  ReloadOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  subscriptionApi,
  useSubscriptionAnomalies,
  useSubscriptionOverview,
} from '@/services/subscriptionManagementService';

const { Text, Title } = Typography;

export const routeConfig = {
  name: 'subscription',
  title: '订阅与付费',
  icon: 'CrownOutlined',
  order: 22,
  requireAuth: true,
  requireAdmin: true,
};

const navCards = [
  {
    key: 'list',
    title: '订阅用户',
    description: '查看当前订阅状态、平台订阅 ID、商品映射和同步健康度。',
    path: '/subscription/list',
    icon: <CrownOutlined />,
  },
  {
    key: 'plans',
    title: '套餐目录',
    description: '维护内部套餐、RevenueCat 商品映射和默认权益配置。',
    path: '/subscription/plans',
    icon: <AppstoreOutlined />,
  },
  {
    key: 'anomalies',
    title: '异常看板',
    description: '定位 webhook 失败、未映射商品和本地状态漂移。',
    path: '/subscription/anomalies',
    icon: <WarningOutlined />,
  },
  {
    key: 'payments',
    title: '支付记录',
    description: '审计支付流水、退款状态和平台交易号。',
    path: '/subscription/payments',
    icon: <DollarOutlined />,
  },
  {
    key: 'jobs',
    title: '维护任务',
    description: '查看后台重同步、权益重建任务的执行状态和失败原因。',
    path: '/subscription/jobs',
    icon: <SyncOutlined />,
  },
  {
    key: 'quotas',
    title: '用量配额',
    description: '查看用户权益消耗、重置额度和付费墙触发统计。',
    path: '/subscription/usage-quotas',
    icon: <FundOutlined />,
  },
];

export default function SubscriptionOverviewPage() {
  const navigate = useNavigate();
  const { data: overview, isLoading: overviewLoading } = useSubscriptionOverview();
  const { data: anomalies, isLoading: anomaliesLoading } =
    useSubscriptionAnomalies({ limit: 10 });

  const handleRebuild = async () => {
    try {
      const result = await subscriptionApi.rebuildEntitlements();
      message.success(
        result.mode === 'queued'
          ? `已提交后台任务，jobId=${result.jobId || '-'}`
          : `已重建 ${result.result?.subscriptions ?? 0} 个有效订阅的用户权益`,
      );
    } catch (err: any) {
      message.error(`重建失败: ${err.message}`);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space
          align="start"
          style={{ width: '100%', justifyContent: 'space-between' }}
          wrap
        >
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
              订阅运营工作台
            </Title>
            <Text type="secondary">
              后端权限已切到数据库权益快照，这里作为目录、异常和运营动作的统一入口。
            </Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={handleRebuild}>
            重建有效权益
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card loading={overviewLoading}>
            <Statistic title="总订阅" value={overview?.totalSubscriptions ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={overviewLoading}>
            <Statistic
              title="活跃订阅"
              value={overview?.activeSubscriptions ?? 0}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={overviewLoading}>
            <Statistic
              title="MRR"
              value={overview ? `${overview.currency} ${(overview.mrr / 100).toFixed(2)}` : '-'}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={anomaliesLoading}>
            <Statistic
              title="异常总数"
              value={
                (anomalies?.summary.failedWebhookCount ?? 0) +
                (anomalies?.summary.orphanTransactionCount ?? 0) +
                (anomalies?.summary.unmappedProductCount ?? 0) +
                (anomalies?.summary.activeWithoutRevenueCatSignalCount ?? 0)
              }
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Alert
        type="warning"
        showIcon
        icon={<AlertOutlined />}
        message="上线前至少要保证三件事：付费套餐 Apple/Google 商品已映射、RevenueCat webhook 无失败积压、本地 active 订阅能被 provider 快照收敛。"
      />

      <Row gutter={[16, 16]}>
        {navCards.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.key}>
            <Card
              hoverable
              onClick={() => navigate(item.path)}
              style={{ height: '100%' }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={10}>
                  <Tag color="blue" icon={item.icon}>
                    {item.title}
                  </Tag>
                </Space>
                <Text type="secondary">{item.description}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="当前风险摘要" loading={anomaliesLoading}>
        <Space size={[8, 8]} wrap>
          <Tag color={anomalies?.summary.failedWebhookCount ? 'error' : 'success'}>
            Webhook 失败 {anomalies?.summary.failedWebhookCount ?? 0}
          </Tag>
          <Tag color={anomalies?.summary.orphanTransactionCount ? 'warning' : 'success'}>
            孤儿交易 {anomalies?.summary.orphanTransactionCount ?? 0}
          </Tag>
          <Tag color={anomalies?.summary.unmappedProductCount ? 'error' : 'success'}>
            未映射商品 {anomalies?.summary.unmappedProductCount ?? 0}
          </Tag>
          <Tag
            color={
              anomalies?.summary.activeWithoutRevenueCatSignalCount
                ? 'warning'
                : 'success'
            }
          >
            本地无 RC 信号 {anomalies?.summary.activeWithoutRevenueCatSignalCount ?? 0}
          </Tag>
        </Space>
      </Card>
    </Space>
  );
}
