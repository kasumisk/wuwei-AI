import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Space,
  Spin,
  Input,
  Segmented,
  Popconfirm,
  Button,
  message,
  Progress,
  Typography,
  Divider,
} from 'antd';
import { ReloadOutlined, SearchOutlined, AlertOutlined, RiseOutlined } from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import {
  useUsageQuotas,
  useResetUsageQuota,
  useTriggerStats,
  type UsageQuotaItem,
  type TriggerStatsByGroup,
} from '@/services/subscriptionManagementService';

const { Search } = Input;
const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'subscription-usage-quotas',
  title: '用量配额',
  icon: 'FundOutlined',
  order: 4,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const CYCLE_LABELS: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#13c2c2', '#fa541c', '#eb2f96'];

// ==================== 用量配额面板 ====================

const UserQuotaPanel: React.FC = () => {
  const [inputId, setInputId] = useState('');
  const [userId, setUserId] = useState('');

  const { data, isLoading } = useUsageQuotas(userId);
  const { mutateAsync: reset } = useResetUsageQuota();

  const handleReset = async (item: UsageQuotaItem) => {
    await reset(item.id);
    message.success(`已重置 ${item.feature} 配额`);
  };

  const columns: ColumnsType<UsageQuotaItem> = [
    {
      title: '功能',
      dataIndex: 'feature',
      render: (v) => (
        <Text code style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '周期',
      dataIndex: 'cycle',
      width: 70,
      render: (v: string) => CYCLE_LABELS[v] ?? v,
    },
    {
      title: '使用进度',
      width: 200,
      render: (_, r) => {
        if (r.quota_limit === -1) {
          return <Tag color="green">无限制</Tag>;
        }
        const pct = Math.round((r.used / r.quota_limit) * 100);
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={pct >= 90 ? '#ff4d4f' : pct >= 70 ? '#faad14' : '#52c41a'}
              style={{ width: 160 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.used} / {r.quota_limit}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '重置时间',
      dataIndex: 'reset_at',
      render: (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '操作',
      width: 80,
      render: (_, record) => (
        <Popconfirm
          title={`重置 ${record.feature} 已用量为 0？`}
          onConfirm={() => handleReset(record)}
          okText="重置"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button size="small" icon={<ReloadOutlined />} danger>
            重置
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <SearchOutlined />
          <span>用户配额查询</span>
        </Space>
      }
      size="small"
    >
      <Search
        placeholder="输入 User ID"
        value={inputId}
        onChange={(e) => setInputId(e.target.value)}
        onSearch={(v) => setUserId(v.trim())}
        enterButton="查询"
        style={{ maxWidth: 420, marginBottom: 16 }}
        allowClear
      />
      <Spin spinning={isLoading}>
        {data && (
          <Table
            size="small"
            dataSource={data.list}
            rowKey="id"
            columns={columns}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </Spin>
    </Card>
  );
};

// ==================== 付费墙触发统计 ====================

const TriggerStatsPanel: React.FC = () => {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useTriggerStats({ days });

  const featureBarData = (data?.byFeature ?? [])
    .sort((a, b) => b.totalTriggers - a.totalTriggers)
    .slice(0, 8)
    .map((d) => ({
      name: d.feature ?? '—',
      触发: d.totalTriggers,
      转化: d.conversions,
    }));

  const sceneBarData = (data?.byScene ?? [])
    .sort((a, b) => b.totalTriggers - a.totalTriggers)
    .slice(0, 8)
    .map((d) => ({
      name: d.triggerScene ?? '—',
      触发: d.totalTriggers,
      转化: d.conversions,
    }));

  const tierConvColumns: ColumnsType<TriggerStatsByGroup> = [
    { title: '当前套餐', dataIndex: 'currentTier', render: (v) => <Tag>{v}</Tag> },
    { title: '触发次数', dataIndex: 'totalTriggers' },
    { title: '转化次数', dataIndex: 'conversions' },
    {
      title: '转化率',
      dataIndex: 'conversionRate',
      render: (v: number) => (
        <Text style={{ color: v >= 10 ? '#52c41a' : v >= 5 ? '#faad14' : '#8c8c8c' }}>
          {v.toFixed(2)}%
        </Text>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <RiseOutlined />
          <span>付费墙触发统计</span>
        </Space>
      }
      size="small"
      extra={
        <Segmented
          size="small"
          value={days}
          onChange={(v) => setDays(v as number)}
          options={[
            { label: '7天', value: 7 },
            { label: '30天', value: 30 },
            { label: '90天', value: 90 },
          ]}
        />
      }
    >
      <Spin spinning={isLoading}>
        {data ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* KPI 行 */}
            <Row gutter={[16, 16]}>
              <Col xs={8}>
                <Card size="small">
                  <Statistic
                    title="总触发次数"
                    value={data.totalTriggers}
                    prefix={<AlertOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={8}>
                <Card size="small">
                  <Statistic
                    title="总转化次数"
                    value={data.totalConversions}
                    prefix={<RiseOutlined />}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Card>
              </Col>
              <Col xs={8}>
                <Card size="small">
                  <Statistic
                    title="整体转化率"
                    value={data.overallConversionRate}
                    suffix="%"
                    valueStyle={{
                      color:
                        data.overallConversionRate >= 10
                          ? '#52c41a'
                          : data.overallConversionRate >= 5
                            ? '#faad14'
                            : '#ff4d4f',
                    }}
                  />
                </Card>
              </Col>
            </Row>

            {/* 按功能 + 按场景柱状图 */}
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card title="按功能触发 Top 8" size="small">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={featureBarData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="触发" fill="#1677ff" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="转化" fill="#52c41a" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card title="按场景触发 Top 8" size="small">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sceneBarData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="触发" fill="#faad14" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="转化" fill="#52c41a" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            {/* 按套餐转化率 */}
            <Card title="按当前套餐转化率" size="small">
              <Table
                size="small"
                dataSource={data.byTier}
                rowKey={(r) => r.currentTier ?? 'unknown'}
                columns={tierConvColumns}
                pagination={false}
              />
            </Card>
          </Space>
        ) : null}
      </Spin>
    </Card>
  );
};

// ==================== 主页面 ====================

const UsageQuotasPage: React.FC = () => (
  <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <TriggerStatsPanel />
    <Divider />
    <UserQuotaPanel />
  </Space>
);

export default UsageQuotasPage;
