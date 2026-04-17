import React, { useState, useMemo } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Row,
  Col,
  Tag,
  Space,
  Typography,
  Table,
  Drawer,
  Descriptions,
  Statistic,
  Alert,
  Spin,
  Empty,
  Badge,
  Tooltip,
  Divider,
  Steps,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  EyeOutlined,
  FilterOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  useTraces,
  useTraceDetail,
  type TraceListItem,
  type TraceListQueryDto,
  type TraceDetail,
  type PipelineStageTrace,
} from '@/services/recommendDebugService';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

export const routeConfig = {
  name: 'recommend-traces',
  title: '推荐追踪',
  icon: 'NodeIndexOutlined',
  order: 6,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const mealTypeOptions = [
  { label: '全部', value: '' },
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
];

const stageLabels: Record<string, { label: string; color: string }> = {
  recall: { label: '召回', color: '#1677ff' },
  realistic_filter: { label: '现实性过滤', color: '#722ed1' },
  rank: { label: '排序', color: '#13c2c2' },
  health_modifier: { label: '健康修正', color: '#52c41a' },
  scoring_chain: { label: '评分链', color: '#faad14' },
  rerank: { label: '重排序', color: '#eb2f96' },
  assemble: { label: '组装', color: '#fa541c' },
};

const STAGE_ORDER = [
  'recall',
  'realistic_filter',
  'rank',
  'health_modifier',
  'scoring_chain',
  'rerank',
  'assemble',
];

// ==================== 工具函数 ====================

const durationColor = (ms: number | null): string => {
  if (ms == null) return '#999';
  if (ms <= 100) return '#52c41a';
  if (ms <= 300) return '#1677ff';
  if (ms <= 500) return '#faad14';
  return '#ff4d4f';
};

const formatDuration = (ms: number | null | undefined): string => {
  if (ms == null) return '-';
  if (ms < 1) return '<1ms';
  return `${Math.round(ms)}ms`;
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm:ss');
};

// ==================== Pipeline 阶段瀑布图 ====================

const PipelineWaterfall: React.FC<{ stages: PipelineStageTrace[] }> = ({ stages }) => {
  if (!stages || stages.length === 0) {
    return <Empty description="无 Pipeline 阶段数据" />;
  }

  // Sort by pipeline order
  const sortedStages = [...stages].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
  );

  const barData = sortedStages.map((s) => ({
    name: stageLabels[s.stage]?.label || s.stage,
    duration: s.durationMs,
    input: s.inputCount,
    output: s.outputCount,
    color: stageLabels[s.stage]?.color || '#999',
    stage: s.stage,
  }));

  const totalMs = stages.reduce((sum, s) => sum + s.durationMs, 0);

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Statistic
            title="总 Pipeline 耗时"
            value={totalMs}
            suffix="ms"
            valueStyle={{ color: durationColor(totalMs) }}
            prefix={<ClockCircleOutlined />}
          />
        </Col>
        <Col span={6}>
          <Statistic title="阶段数" value={stages.length} prefix={<NodeIndexOutlined />} />
        </Col>
        <Col span={6}>
          <Statistic
            title="最慢阶段"
            value={
              stageLabels[
                sortedStages.reduce((a, b) => (a.durationMs > b.durationMs ? a : b)).stage
              ]?.label || '-'
            }
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="最终输出"
            value={sortedStages[sortedStages.length - 1]?.outputCount ?? '-'}
            suffix="个食物"
          />
        </Col>
      </Row>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={barData} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
          <RechartsTooltip
            formatter={(value: number, name: string) => {
              if (name === '耗时') return [`${value}ms`, name];
              return [value, name];
            }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                  <div>
                    耗时: <span style={{ color: d.color }}>{d.duration}ms</span>
                  </div>
                  <div>输入: {d.input} 个</div>
                  <div>输出: {d.output} 个</div>
                  <div>
                    淘汰率:{' '}
                    {d.input > 0 ? `${(((d.input - d.output) / d.input) * 100).toFixed(1)}%` : '-'}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="duration" name="耗时" radius={[4, 4, 0, 0]}>
            {barData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Pipeline 流水线 Steps */}
      <Divider style={{ margin: '16px 0' }}>候选食物流量</Divider>
      <Steps
        size="small"
        items={sortedStages.map((s) => ({
          title: <span style={{ fontSize: 12 }}>{stageLabels[s.stage]?.label || s.stage}</span>,
          description: (
            <span style={{ fontSize: 11 }}>
              {s.inputCount} → {s.outputCount}{' '}
              <Text type="secondary" style={{ fontSize: 10 }}>
                ({formatDuration(s.durationMs)})
              </Text>
            </span>
          ),
          status: 'finish' as const,
        }))}
      />
    </div>
  );
};

// ==================== 阶段详情 ====================

const StageDetailCards: React.FC<{ stages: PipelineStageTrace[] }> = ({ stages }) => {
  if (!stages || stages.length === 0) return null;

  const sortedStages = [...stages].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
  );

  return (
    <Row gutter={[12, 12]}>
      {sortedStages.map((s) => {
        const meta = stageLabels[s.stage] || { label: s.stage, color: '#999' };
        const filterRate =
          s.inputCount > 0
            ? (((s.inputCount - s.outputCount) / s.inputCount) * 100).toFixed(1)
            : '0';

        return (
          <Col xs={24} sm={12} md={8} key={s.stage}>
            <Card
              size="small"
              title={
                <Space>
                  <Badge color={meta.color} />
                  <span>{meta.label}</span>
                </Space>
              }
              extra={
                <Tag color={durationColor(s.durationMs) === '#52c41a' ? 'success' : 'default'}>
                  {formatDuration(s.durationMs)}
                </Tag>
              }
            >
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic title="输入" value={s.inputCount} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={8}>
                  <Statistic title="输出" value={s.outputCount} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="淘汰率"
                    value={filterRate}
                    suffix="%"
                    valueStyle={{
                      fontSize: 16,
                      color: parseFloat(filterRate) > 50 ? '#faad14' : '#52c41a',
                    }}
                  />
                </Col>
              </Row>
              {s.details && Object.keys(s.details).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    详情:
                  </Text>
                  <pre
                    style={{
                      background: '#f5f5f5',
                      padding: 8,
                      borderRadius: 4,
                      fontSize: 11,
                      maxHeight: 120,
                      overflow: 'auto',
                      marginTop: 4,
                    }}
                  >
                    {JSON.stringify(s.details, null, 2)}
                  </pre>
                </div>
              )}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
};

// ==================== Trace 详情抽屉 ====================

const TraceDetailDrawer: React.FC<{
  traceId: string | null;
  open: boolean;
  onClose: () => void;
}> = ({ traceId, open, onClose }) => {
  const { data, isLoading, isError, error } = useTraceDetail(traceId || '', {
    enabled: !!traceId && open,
  });

  return (
    <Drawer
      title={
        <Space>
          <NodeIndexOutlined />
          <span>追踪详情</span>
          {traceId && (
            <Tag color="processing" style={{ fontSize: 11 }}>
              {traceId.slice(0, 8)}...
            </Tag>
          )}
        </Space>
      }
      placement="right"
      width={900}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip="加载追踪详情..." />
        </div>
      )}

      {isError && (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={(error as Error)?.message || '请稍后重试'}
        />
      )}

      {data && <TraceDetailContent detail={data} />}
    </Drawer>
  );
};

const TraceDetailContent: React.FC<{ detail: TraceDetail }> = ({ detail }) => {
  const stages = detail.traceData?.stages || [];

  return (
    <div>
      {/* 基础信息 */}
      <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="Trace ID">
            <Text copyable style={{ fontSize: 12 }}>
              {detail.id}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="用户 ID">
            <Text copyable style={{ fontSize: 12 }}>
              {detail.userId}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="餐次">
            <Tag color="blue">{detail.mealType}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="目标">
            <Tag color="green">{detail.goalType}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="渠道">
            <Tag>{detail.channel}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="策略">
            <Space>
              {detail.strategyName && <Tag color="purple">{detail.strategyName}</Tag>}
              {detail.strategyId && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {detail.strategyId.slice(0, 8)}...
                </Text>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="场景">
            <Tag color="cyan">{detail.sceneName || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="现实性等级">
            <Tag>{detail.realismLevel || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="候选流">
            <Text>{detail.candidateFlow || '-'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="缓存命中">
            {detail.cacheHit ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                命中
              </Tag>
            ) : (
              <Tag color="default">未命中</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="食物池大小">
            <Text>{detail.foodPoolSize ?? '-'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="耗时">
            <Text strong style={{ color: durationColor(detail.totalDurationMs) }}>
              {formatDuration(detail.totalDurationMs)}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDate(detail.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDate(detail.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 降级警告 */}
      {detail.degradations && detail.degradations.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={`Pipeline 降级 (${detail.degradations.length} 处)`}
          description={
            <Space wrap>
              {detail.degradations.map((d, i) => (
                <Tag key={i} color="warning">
                  {d}
                </Tag>
              ))}
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 实验信息 */}
      {(detail.experimentId || detail.groupId) && (
        <Card size="small" title="实验信息" style={{ marginBottom: 16 }}>
          <Descriptions column={2} size="small">
            <Descriptions.Item label="实验 ID">
              <Text copyable style={{ fontSize: 12 }}>
                {detail.experimentId || '-'}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="实验组">
              <Tag color="processing">{detail.groupId || '-'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="策略版本">
              <Tag>{detail.strategyVersion || '-'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 评分统计 */}
      {detail.scoreStats && (
        <Card size="small" title="评分统计" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={5}>
              <Statistic
                title="最低分"
                value={(detail.scoreStats.min * 100).toFixed(1)}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title="最高分"
                value={(detail.scoreStats.max * 100).toFixed(1)}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title="平均分"
                value={(detail.scoreStats.avg * 100).toFixed(1)}
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
            <Col span={5}>
              <Statistic title="标准差" value={(detail.scoreStats.std * 100).toFixed(2)} />
            </Col>
            <Col span={4}>
              <Statistic title="食物数" value={detail.scoreStats.count} />
            </Col>
          </Row>
        </Card>
      )}

      {/* Pipeline 阶段瀑布图 */}
      <Card size="small" title="Pipeline 阶段瀑布" style={{ marginBottom: 16 }}>
        <PipelineWaterfall stages={stages} />
      </Card>

      {/* 阶段详情卡片 */}
      {stages.length > 0 && (
        <Card size="small" title="阶段详情" style={{ marginBottom: 16 }}>
          <StageDetailCards stages={stages} />
        </Card>
      )}

      {/* Top 食物 */}
      {detail.topFoods && detail.topFoods.length > 0 && (
        <Card
          size="small"
          title={`Top 食物 (${detail.topFoods.length})`}
          style={{ marginBottom: 16 }}
        >
          <Table
            dataSource={detail.topFoods}
            rowKey={(_, i) => `food-${i}`}
            size="small"
            pagination={false}
            scroll={{ x: 600 }}
            columns={[
              {
                title: '#',
                key: 'idx',
                width: 40,
                render: (_, __, i) => (
                  <Badge
                    count={i + 1}
                    style={{ backgroundColor: i === 0 ? '#52c41a' : '#1677ff' }}
                  />
                ),
              },
              {
                title: '食物名称',
                dataIndex: 'name',
                key: 'name',
                width: 160,
                render: (name: string, record: any) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{name || record.foodName || '-'}</Text>
                    {record.category && <Tag style={{ fontSize: 10 }}>{record.category}</Tag>}
                  </Space>
                ),
              },
              {
                title: '评分',
                dataIndex: 'score',
                key: 'score',
                width: 80,
                sorter: (a: any, b: any) => (a.score ?? 0) - (b.score ?? 0),
                defaultSortOrder: 'descend',
                render: (score: number) =>
                  score != null ? (
                    <Text
                      strong
                      style={{
                        color: durationColor(1 - score) === '#52c41a' ? '#52c41a' : '#1677ff',
                      }}
                    >
                      {(score * 100).toFixed(1)}
                    </Text>
                  ) : (
                    '-'
                  ),
              },
              {
                title: '热量',
                dataIndex: 'calories',
                key: 'calories',
                width: 80,
                render: (cal: number) =>
                  cal != null ? <Tag color="red">{Math.round(cal)} kcal</Tag> : '-',
              },
              {
                title: '蛋白质',
                dataIndex: 'protein',
                key: 'protein',
                width: 80,
                render: (p: number) => (p != null ? <Tag color="blue">{p.toFixed(1)}g</Tag> : '-'),
              },
            ]}
          />
        </Card>
      )}

      {/* 过滤器快照 */}
      {detail.filtersApplied && Object.keys(detail.filtersApplied).length > 0 && (
        <Card size="small" title="应用的过滤器" style={{ marginBottom: 16 }}>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(detail.filtersApplied, null, 2)}
          </pre>
        </Card>
      )}

      {/* Pipeline 快照 JSON */}
      {detail.pipelineSnapshot && Object.keys(detail.pipelineSnapshot).length > 0 && (
        <Card size="small" title="Pipeline 配置快照">
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(detail.pipelineSnapshot, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
};

// ==================== 主组件 ====================

const TracesPage: React.FC = () => {
  const [form] = Form.useForm();
  const [query, setQuery] = useState<TraceListQueryDto>({ page: 1, pageSize: 20 });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useTraces(query);

  const handleSearch = () => {
    const values = form.getFieldsValue();
    const newQuery: TraceListQueryDto = {
      page: 1,
      pageSize: query.pageSize || 20,
    };
    if (values.userId?.trim()) newQuery.userId = values.userId.trim();
    if (values.mealType) newQuery.mealType = values.mealType;
    if (values.sceneName?.trim()) newQuery.sceneName = values.sceneName.trim();
    if (values.dateRange && values.dateRange.length === 2) {
      newQuery.startDate = values.dateRange[0].format('YYYY-MM-DD');
      newQuery.endDate = values.dateRange[1].format('YYYY-MM-DD');
    }
    setQuery(newQuery);
  };

  const handleReset = () => {
    form.resetFields();
    setQuery({ page: 1, pageSize: 20 });
  };

  const handleViewDetail = (traceId: string) => {
    setSelectedTraceId(traceId);
    setDrawerOpen(true);
  };

  // 表格列定义
  const columns: ColumnsType<TraceListItem> = [
    {
      title: '用户 ID',
      dataIndex: 'userId',
      key: 'userId',
      width: 120,
      ellipsis: true,
      render: (userId: string) => (
        <Tooltip title={userId}>
          <Text copyable={{ text: userId }} style={{ fontSize: 12 }}>
            {userId.slice(0, 8)}...
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '餐次',
      dataIndex: 'mealType',
      key: 'mealType',
      width: 80,
      filters: [
        { text: '早餐', value: 'breakfast' },
        { text: '午餐', value: 'lunch' },
        { text: '晚餐', value: 'dinner' },
        { text: '加餐', value: 'snack' },
      ],
      onFilter: (value, record) => record.mealType === value,
      render: (mealType: string) => {
        const labels: Record<string, string> = {
          breakfast: '早餐',
          lunch: '午餐',
          dinner: '晚餐',
          snack: '加餐',
        };
        return <Tag color="blue">{labels[mealType] || mealType}</Tag>;
      },
    },
    {
      title: '目标',
      dataIndex: 'goalType',
      key: 'goalType',
      width: 80,
      render: (goalType: string) => {
        const labels: Record<string, { text: string; color: string }> = {
          fat_loss: { text: '减脂', color: 'red' },
          muscle_gain: { text: '增肌', color: 'blue' },
          health: { text: '健康', color: 'green' },
          habit: { text: '习惯', color: 'purple' },
        };
        const meta = labels[goalType] || { text: goalType, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '策略',
      dataIndex: 'strategyName',
      key: 'strategyName',
      width: 100,
      ellipsis: true,
      render: (name: string | null) =>
        name ? <Tag color="purple">{name}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '场景',
      dataIndex: 'sceneName',
      key: 'sceneName',
      width: 80,
      render: (name: string | null) =>
        name ? <Tag color="cyan">{name}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '耗时',
      dataIndex: 'totalDurationMs',
      key: 'totalDurationMs',
      width: 90,
      sorter: (a, b) => (a.totalDurationMs ?? 0) - (b.totalDurationMs ?? 0),
      render: (ms: number | null) => (
        <Text strong style={{ color: durationColor(ms) }}>
          {formatDuration(ms)}
        </Text>
      ),
    },
    {
      title: '候选池',
      dataIndex: 'foodPoolSize',
      key: 'foodPoolSize',
      width: 80,
      sorter: (a, b) => (a.foodPoolSize ?? 0) - (b.foodPoolSize ?? 0),
      render: (size: number | null) =>
        size != null ? (
          <Space size={4}>
            <DatabaseOutlined style={{ color: '#1677ff' }} />
            <Text>{size}</Text>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '缓存',
      dataIndex: 'cacheHit',
      key: 'cacheHit',
      width: 70,
      filters: [
        { text: '命中', value: true },
        { text: '未命中', value: false },
      ],
      onFilter: (value, record) => record.cacheHit === value,
      render: (hit: boolean | null) => {
        if (hit == null) return <Text type="secondary">-</Text>;
        return hit ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            命中
          </Tag>
        ) : (
          <Tag color="default">未命中</Tag>
        );
      },
    },
    {
      title: '现实性',
      dataIndex: 'realismLevel',
      key: 'realismLevel',
      width: 80,
      render: (level: string | null) =>
        level ? <Tag>{level}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
      render: (date: string) => <Text style={{ fontSize: 12 }}>{formatDate(date)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetail(record.id)}
        >
          详情
        </Button>
      ),
    },
  ];

  // 汇总统计
  const summary = useMemo(() => {
    if (!data?.data || data.data.length === 0) return null;
    const items = data.data;
    const withDuration = items.filter((d) => d.totalDurationMs != null);
    const avgDuration =
      withDuration.length > 0
        ? withDuration.reduce((s, d) => s + (d.totalDurationMs ?? 0), 0) / withDuration.length
        : 0;
    const cacheHits = items.filter((d) => d.cacheHit === true).length;
    const cacheTotal = items.filter((d) => d.cacheHit != null).length;

    return {
      total: data.total,
      avgDuration: Math.round(avgDuration),
      cacheHitRate: cacheTotal > 0 ? ((cacheHits / cacheTotal) * 100).toFixed(1) : '-',
      pageCount: items.length,
    };
  }, [data]);

  return (
    <div>
      {/* 搜索表单 */}
      <Card
        title={
          <Space>
            <FilterOutlined />
            <span>追踪查询</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="userId" label="用户 ID">
                <Input placeholder="输入用户 UUID" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="mealType" label="餐次类型">
                <Select placeholder="全部" allowClear options={mealTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="sceneName" label="场景名称">
                <Input placeholder="场景名称" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="dateRange" label="时间范围">
                <RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ width: '100%' }}>
                <Space>
                  <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
                    搜索
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 汇总统计 */}
      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="总追踪数" value={summary.total} prefix={<ExperimentOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="当页数量" value={summary.pageCount} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic
                title="平均耗时"
                value={summary.avgDuration}
                suffix="ms"
                valueStyle={{ color: durationColor(summary.avgDuration) }}
                prefix={<ClockCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic
                title="缓存命中率"
                value={summary.cacheHitRate}
                suffix="%"
                valueStyle={{ color: '#52c41a' }}
                prefix={<ThunderboltOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 错误提示 */}
      {isError && (
        <Alert
          type="error"
          showIcon
          message="加载追踪列表失败"
          description={(error as Error)?.message || '请检查网络连接或稍后重试'}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => refetch()}>
              重试
            </Button>
          }
        />
      )}

      {/* 追踪列表表格 */}
      <Card
        title={
          <Space>
            <NodeIndexOutlined />
            <span>追踪记录</span>
            {data && <Tag>{data.total} 条</Tag>}
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            刷新
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={data?.data || []}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 1200 }}
          size="small"
          pagination={{
            current: query.page || 1,
            pageSize: query.pageSize || 20,
            total: data?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (page, pageSize) => {
              setQuery((prev) => ({ ...prev, page, pageSize }));
            },
          }}
          locale={{
            emptyText: <Empty description="暂无追踪记录，请调整查询条件" />,
          }}
        />
      </Card>

      {/* 详情抽屉 */}
      <TraceDetailDrawer
        traceId={selectedTraceId}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedTraceId(null);
        }}
      />
    </div>
  );
};

export default TracesPage;
