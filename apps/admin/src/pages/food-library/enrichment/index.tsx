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
  Tag,
  Divider,
  Row,
  Col,
  Statistic,
  Table,
  Progress,
  Badge,
  Tooltip,
  Modal,
  Input,
  Tabs,
  Descriptions,
  Popconfirm,
} from 'antd';
import {
  ThunderboltOutlined,
  ScanOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  HistoryOutlined,
  ExclamationCircleOutlined,
  GlobalOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useScanEnrichment,
  useEnqueueEnrichment,
  useEnrichmentStats,
  useEnrichmentJobs,
  useCleanEnrichmentJobs,
  useStagedEnrichments,
  useEnrichmentHistory,
  useApproveStaged,
  useRejectStaged,
  useBatchApproveStaged,
  type MissingFieldStats,
  type EnrichmentJob,
  type EnrichableField,
  type EnrichmentTarget,
  type StagedEnrichment,
} from '@/services/foodPipelineService';
import { LOCALE_OPTIONS } from '@/pages/food-library/constants';

export const routeConfig = {
  name: 'enrichment',
  title: 'AI 数据补全',
  icon: 'ThunderboltOutlined',
  order: 5,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

// ─── 字段元数据 ────────────────────────────────────────────────────────────

const ALL_FIELDS: { value: EnrichableField; label: string; group: string }[] = [
  // 营养素
  { value: 'protein', label: '蛋白质', group: '营养素' },
  { value: 'fat', label: '脂肪', group: '营养素' },
  { value: 'carbs', label: '碳水化合物', group: '营养素' },
  { value: 'fiber', label: '膳食纤维', group: '营养素' },
  { value: 'sugar', label: '糖', group: '营养素' },
  { value: 'added_sugar', label: '添加糖', group: '营养素' },
  { value: 'natural_sugar', label: '天然糖', group: '营养素' },
  { value: 'sodium', label: '钠', group: '营养素' },
  { value: 'calcium', label: '钙', group: '营养素' },
  { value: 'iron', label: '铁', group: '营养素' },
  { value: 'potassium', label: '钾', group: '营养素' },
  { value: 'cholesterol', label: '胆固醇', group: '营养素' },
  { value: 'vitamin_a', label: '维生素A', group: '营养素' },
  { value: 'vitamin_c', label: '维生素C', group: '营养素' },
  { value: 'vitamin_d', label: '维生素D', group: '营养素' },
  { value: 'vitamin_e', label: '维生素E', group: '营养素' },
  { value: 'vitamin_b12', label: '维生素B12', group: '营养素' },
  { value: 'folate', label: '叶酸', group: '营养素' },
  { value: 'zinc', label: '锌', group: '营养素' },
  { value: 'magnesium', label: '镁', group: '营养素' },
  { value: 'saturated_fat', label: '饱和脂肪', group: '营养素' },
  { value: 'trans_fat', label: '反式脂肪', group: '营养素' },
  { value: 'purine', label: '嘌呤', group: '营养素' },
  { value: 'phosphorus', label: '磷', group: '营养素' },
  // 属性
  { value: 'sub_category', label: '二级分类', group: '属性' },
  { value: 'food_group', label: '食物组', group: '属性' },
  { value: 'cuisine', label: '菜系', group: '属性' },
  { value: 'cooking_method', label: '烹饪方式', group: '属性' },
  { value: 'glycemic_index', label: '血糖指数(GI)', group: '属性' },
  { value: 'glycemic_load', label: '血糖负荷(GL)', group: '属性' },
  { value: 'fodmap_level', label: 'FODMAP等级', group: '属性' },
  { value: 'oxalate_level', label: '草酸等级', group: '属性' },
  { value: 'processing_level', label: '加工程度', group: '属性' },
  { value: 'main_ingredient', label: '主原料', group: '属性' },
  { value: 'standard_serving_desc', label: '标准份量描述', group: '属性' },
  // 标签评分
  { value: 'meal_types', label: '餐次类型', group: '标签评分' },
  { value: 'allergens', label: '过敏原', group: '标签评分' },
  { value: 'tags', label: '营养标签', group: '标签评分' },
  { value: 'common_portions', label: '常用份量', group: '标签评分' },
  { value: 'quality_score', label: '品质评分', group: '标签评分' },
  { value: 'satiety_score', label: '饱腹感评分', group: '标签评分' },
  { value: 'nutrient_density', label: '营养密度', group: '标签评分' },
  { value: 'commonality_score', label: '大众化评分', group: '标签评分' },
  { value: 'flavor_profile', label: '风味档案', group: '标签评分' },
];

const FIELD_LABEL_MAP = Object.fromEntries(ALL_FIELDS.map((f) => [f.value, f.label]));

const FIELD_OPTIONS = ALL_FIELDS.map((f) => ({
  label: `${f.label} (${f.value})`,
  value: f.value,
}));

const REGION_OPTIONS = [
  { label: '中国大陆 (CN)', value: 'CN' },
  { label: '中国香港 (HK)', value: 'HK' },
  { label: '中国台湾 (TW)', value: 'TW' },
  { label: '美国 (US)', value: 'US' },
  { label: '日本 (JP)', value: 'JP' },
  { label: '韩国 (KR)', value: 'KR' },
];

// ─── 状态配置 ────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { color: string; text: string }> = {
  ai_enrichment: { color: 'success', text: '已入库' },
  ai_enrichment_staged: { color: 'warning', text: '待审核' },
  ai_enrichment_approved: { color: 'success', text: '已通过' },
  ai_enrichment_rejected: { color: 'error', text: '已拒绝' },
};

// ─── 组件 ─────────────────────────────────────────────────────────────────

const EnrichmentPage: React.FC = () => {
  const [enqueueForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [scanResult, setScanResult] = useState<MissingFieldStats | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<
    'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | undefined
  >(undefined);
  const [stagedPage, setStagedPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string }>({
    open: false,
    id: '',
  });
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    record: StagedEnrichment | null;
  }>({
    open: false,
    record: null,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Hooks
  const { data: queueStats, refetch: refetchStats } = useEnrichmentStats();
  const { data: jobs, refetch: refetchJobs } = useEnrichmentJobs(jobStatusFilter, 30);
  const { data: staged, refetch: refetchStaged } = useStagedEnrichments({
    page: stagedPage,
    pageSize: 20,
  });
  const { data: history, refetch: refetchHistory } = useEnrichmentHistory({
    page: historyPage,
    pageSize: 20,
  });

  const scanMutation = useScanEnrichment({
    onSuccess: (data) => {
      setScanResult(data);
      message.success('扫描完成');
    },
    onError: (e) => message.error(`扫描失败: ${e.message}`),
  });

  const enqueueMutation = useEnqueueEnrichment({
    onSuccess: (data) => {
      message.success(
        `已入队 ${data.enqueued} 个${data.target}补全任务${data.staged ? '（Staging 模式）' : ''}`
      );
      refetchStats();
      refetchJobs();
    },
    onError: (e) => message.error(`入队失败: ${e.message}`),
  });

  const cleanMutation = useCleanEnrichmentJobs({
    onSuccess: (data) => {
      message.success(`已清理 ${data.cleaned} 个任务`);
      refetchStats();
      refetchJobs();
    },
    onError: (e) => message.error(`清理失败: ${e.message}`),
  });

  const approveMutation = useApproveStaged({
    onSuccess: (data) => {
      message.success(`审核通过: ${data.detail}`);
      refetchStaged();
      refetchHistory();
      setSelectedRowKeys([]);
    },
    onError: (e) => message.error(`审核失败: ${e.message}`),
  });

  const rejectMutation = useRejectStaged({
    onSuccess: () => {
      message.success('已拒绝');
      setRejectModal({ open: false, id: '' });
      refetchStaged();
    },
    onError: (e) => message.error(`拒绝失败: ${e.message}`),
  });

  const batchApproveMutation = useBatchApproveStaged({
    onSuccess: (data) => {
      message.success(`批量通过: ${data.success} 成功，${data.failed} 失败`);
      refetchStaged();
      refetchHistory();
      setSelectedRowKeys([]);
    },
    onError: (e) => message.error(`批量操作失败: ${e.message}`),
  });

  // 缺失字段排行（前12条）
  const missingRanking = scanResult
    ? Object.entries(scanResult.fields)
        .sort(([, a], [, b]) => b - a)
        .filter(([, c]) => c > 0)
        .slice(0, 12)
    : [];

  // ─── 队列任务列 ──────────────────────────────────────────────────────

  const jobColumns: ColumnsType<EnrichmentJob> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (s: string) => (
        <Badge
          status={s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'processing'}
          text={s === 'completed' ? '完成' : s === 'failed' ? '失败' : '排队'}
        />
      ),
    },
    {
      title: '目标',
      dataIndex: 'target',
      width: 90,
      render: (t: string, r: EnrichmentJob) => (
        <Space size={2}>
          {t === 'translations' ? (
            <GlobalOutlined />
          ) : t === 'regional' ? (
            <EnvironmentOutlined />
          ) : (
            <ThunderboltOutlined />
          )}
          <Text style={{ fontSize: 12 }}>{t}</Text>
          {r.locale && <Tag style={{ fontSize: 10 }}>{r.locale}</Tag>}
          {r.region && <Tag style={{ fontSize: 10 }}>{r.region}</Tag>}
        </Space>
      ),
    },
    {
      title: '食物 ID',
      dataIndex: 'foodId',
      width: 120,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text code style={{ fontSize: 11 }}>
            {id.slice(0, 8)}…
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '补全字段',
      dataIndex: 'fields',
      render: (fields: string[]) =>
        fields?.length > 0 ? (
          <Space wrap size={2}>
            {fields.slice(0, 4).map((f) => (
              <Tag key={f} style={{ fontSize: 10, padding: '0 4px' }}>
                {FIELD_LABEL_MAP[f] || f}
              </Tag>
            ))}
            {fields.length > 4 && <Tag style={{ fontSize: 10 }}>+{fields.length - 4}</Tag>}
          </Space>
        ) : (
          '-'
        ),
    },
    { title: '重试', dataIndex: 'attemptsMade', width: 60, align: 'center' },
    {
      title: '模式',
      dataIndex: 'staged',
      width: 80,
      render: (s: boolean) => <Tag color={s ? 'orange' : 'blue'}>{s ? 'Staging' : '直接'}</Tag>,
    },
    {
      title: '失败原因',
      dataIndex: 'failedReason',
      ellipsis: true,
      render: (r: string | null) =>
        r ? (
          <Text type="danger" ellipsis>
            {r}
          </Text>
        ) : (
          '-'
        ),
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      width: 150,
      render: (ts: number) => (ts ? new Date(ts).toLocaleString('zh-CN') : '-'),
    },
  ];

  // ─── Staging 审核列 ───────────────────────────────────────────────────

  const stagedColumns: ColumnsType<StagedEnrichment> = [
    {
      title: '食物',
      key: 'food',
      width: 140,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>
            {r.foodName ?? '-'}
          </Text>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {r.foodId.slice(0, 8)}
          </Text>
        </Space>
      ),
    },
    {
      title: '目标',
      key: 'target',
      width: 110,
      render: (_, r) => {
        const t = r.changes?.target ?? 'foods';
        const locale = r.changes?.locale;
        const region = r.changes?.region;
        return (
          <Space size={2}>
            <Tag color={t === 'translations' ? 'purple' : t === 'regional' ? 'geekblue' : 'blue'}>
              {t === 'translations' ? '翻译' : t === 'regional' ? '地区' : '主表'}
            </Tag>
            {locale && <Tag>{locale}</Tag>}
            {region && <Tag>{region}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '置信度',
      key: 'confidence',
      width: 90,
      render: (_, r) => {
        const conf = r.changes?.proposedValues?.confidence ?? r.changes?.confidence;
        if (conf == null) return '-';
        const pct = Math.round(conf * 100);
        return <Tag color={pct >= 80 ? 'green' : pct >= 60 ? 'orange' : 'red'}>{pct}%</Tag>;
      },
    },
    {
      title: '补全字段预览',
      key: 'fields',
      render: (_, r) => {
        const proposed = r.changes?.proposedValues ?? {};
        const entries = Object.entries(proposed)
          .filter(([k, v]) => k !== 'confidence' && k !== 'reasoning' && v != null)
          .slice(0, 5);
        return (
          <Space wrap size={2}>
            {entries.map(([k, v]) => (
              <Tooltip
                key={k}
                title={`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`}
              >
                <Tag style={{ fontSize: 11, cursor: 'pointer' }}>
                  {FIELD_LABEL_MAP[k as EnrichableField] || k}
                </Tag>
              </Tooltip>
            ))}
            {Object.keys(proposed).filter(
              (k) => k !== 'confidence' && k !== 'reasoning' && proposed[k] != null
            ).length > 5 && <Tag>+{Object.keys(proposed).length - 7}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '推理说明',
      key: 'reasoning',
      ellipsis: true,
      render: (_, r) => {
        const reasoning = r.changes?.proposedValues?.reasoning ?? r.changes?.reasoning;
        return reasoning ? (
          <Tooltip title={reasoning}>
            <Text
              type="secondary"
              ellipsis
              style={{ fontSize: 12, maxWidth: 200, display: 'inline-block' }}
            >
              {reasoning}
            </Text>
          </Tooltip>
        ) : (
          '-'
        );
      },
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => setDetailModal({ open: true, record: r })}
          >
            详情
          </Button>
          <Popconfirm title="确认通过此补全并入库？" onConfirm={() => approveMutation.mutate(r.id)}>
            <Button
              type="link"
              size="small"
              style={{ color: '#52c41a' }}
              loading={approveMutation.isPending}
            >
              通过
            </Button>
          </Popconfirm>
          <Button
            type="link"
            danger
            size="small"
            onClick={() => setRejectModal({ open: true, id: r.id })}
          >
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  // ─── 历史日志列 ───────────────────────────────────────────────────────

  const historyColumns: ColumnsType<StagedEnrichment> = [
    {
      title: '食物',
      key: 'food',
      width: 140,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>
            {r.foodName ?? '-'}
          </Text>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {r.foodId.slice(0, 8)}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      width: 100,
      render: (a: string) => {
        const cfg = ACTION_CONFIG[a] ?? { color: 'default', text: a };
        return <Badge status={cfg.color as any} text={cfg.text} />;
      },
    },
    {
      title: '目标',
      key: 'target',
      width: 100,
      render: (_, r) => {
        const t = r.changes?.target ?? 'foods';
        return (
          <Tag color={t === 'translations' ? 'purple' : t === 'regional' ? 'geekblue' : 'blue'}>
            {t === 'translations' ? '翻译' : t === 'regional' ? '地区' : '主表'}
          </Tag>
        );
      },
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      width: 100,
    },
    {
      title: '说明',
      dataIndex: 'reason',
      ellipsis: true,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div>
      {/* 队列统计 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { label: '等待中', key: 'waiting', color: '#1677ff' },
          { label: '处理中', key: 'active', color: '#fa8c16' },
          { label: '已完成', key: 'completed', color: '#52c41a' },
          { label: '失败', key: 'failed', color: '#ff4d4f' },
          { label: '延迟', key: 'delayed', color: '#722ed1' },
        ].map(({ label, key, color }) => (
          <Col xs={12} sm={8} md={4} key={key}>
            <Card size="small">
              <Statistic
                title={label}
                value={(queueStats as any)?.[key] ?? 0}
                valueStyle={{ color, fontSize: 22 }}
              />
            </Card>
          </Col>
        ))}
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
            <Button
              icon={<ReloadOutlined />}
              block
              size="small"
              onClick={() => {
                refetchStats();
                refetchJobs();
                refetchStaged();
              }}
            >
              刷新
            </Button>
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="enqueue"
        items={[
          // ─── Tab 1: 入队管理 ───────────────────────────────────────────
          {
            key: 'enqueue',
            label: (
              <Space>
                <ThunderboltOutlined />
                入队补全
              </Space>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                {/* 扫描 */}
                <Card
                  title={
                    <Space>
                      <ScanOutlined />
                      缺失字段扫描
                    </Space>
                  }
                  extra={
                    <Button
                      type="primary"
                      icon={<ScanOutlined />}
                      loading={scanMutation.isPending}
                      onClick={() => scanMutation.mutate()}
                    >
                      开始扫描
                    </Button>
                  }
                >
                  <Alert
                    message="扫描说明"
                    description="统计 foods 主表及关联表中各字段的缺失情况。不修改任何数据。"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  {scanResult && (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col>
                          <Text strong>食物总数：</Text>
                          <Text>{scanResult.total}</Text>
                        </Col>
                        <Col>
                          <Text strong>缺少翻译：</Text>
                          <Text type="warning">{scanResult.translationsMissing}</Text>
                        </Col>
                        <Col>
                          <Text strong>缺少地区信息：</Text>
                          <Text type="warning">{scanResult.regionalMissing}</Text>
                        </Col>
                      </Row>
                      <div style={{ maxWidth: 640 }}>
                        {missingRanking.map(([field, count]) => {
                          const info = ALL_FIELDS.find((f) => f.value === field);
                          const pct =
                            scanResult.total > 0 ? Math.round((count / scanResult.total) * 100) : 0;
                          return (
                            <div key={field} style={{ marginBottom: 8 }}>
                              <Row justify="space-between" style={{ marginBottom: 2 }}>
                                <Text style={{ fontSize: 12 }}>
                                  {info?.label || field}
                                  <Text type="secondary" style={{ marginLeft: 4, fontSize: 11 }}>
                                    ({field})
                                  </Text>
                                </Text>
                                <Text style={{ fontSize: 12 }}>
                                  {count} / {scanResult.total}
                                </Text>
                              </Row>
                              <Progress
                                percent={pct}
                                size="small"
                                strokeColor={
                                  pct > 50 ? '#ff4d4f' : pct > 20 ? '#fa8c16' : '#52c41a'
                                }
                                format={(p) => `${p}% 缺失`}
                              />
                            </div>
                          );
                        })}
                        {missingRanking.length === 0 && (
                          <Alert message="foods 主表所有字段均已填写" type="success" showIcon />
                        )}
                      </div>
                    </>
                  )}
                </Card>

                {/* 入队 */}
                <Card
                  title={
                    <Space>
                      <ThunderboltOutlined />
                      批量入队 AI 补全
                    </Space>
                  }
                >
                  <Alert
                    message="补全规则"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>只补全 null / 空数组 字段，不覆盖已有数据</li>
                        <li>
                          <strong>直接模式</strong>：AI 结果直接写入数据库（confidence ≥ 0.7）
                        </li>
                        <li>
                          <strong>Staging 模式</strong>：AI 结果先暂存待人工审核，或 confidence &lt;
                          0.7 时自动转暂存
                        </li>
                        <li>
                          所有操作写入 food_change_logs（ai_enrichment / ai_enrichment_staged）
                        </li>
                      </ul>
                    }
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Form
                    form={enqueueForm}
                    layout="vertical"
                    initialValues={{ limit: 50, target: 'foods', staged: false }}
                    onFinish={(values) => enqueueMutation.mutate(values)}
                  >
                    <Row gutter={16}>
                      <Col xs={24} sm={8}>
                        <Form.Item name="target" label="补全目标" rules={[{ required: true }]}>
                          <Select
                            options={[
                              { label: '主表字段 (foods)', value: 'foods' },
                              { label: '翻译 (food_translations)', value: 'translations' },
                              { label: '地区信息 (food_regional_info)', value: 'regional' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.target !== cur.target}>
                          {({ getFieldValue }) =>
                            getFieldValue('target') === 'translations' ? (
                              <Form.Item name="locale" label="目标语言">
                                <Select options={LOCALE_OPTIONS} placeholder="选择语言" />
                              </Form.Item>
                            ) : getFieldValue('target') === 'regional' ? (
                              <Form.Item name="region" label="目标地区">
                                <Select options={REGION_OPTIONS} placeholder="选择地区" />
                              </Form.Item>
                            ) : (
                              <Form.Item name="fields" label="补全字段">
                                <Select
                                  mode="multiple"
                                  options={FIELD_OPTIONS}
                                  placeholder="不选则补全所有缺失字段"
                                  maxTagCount={3}
                                  allowClear
                                />
                              </Form.Item>
                            )
                          }
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Row gutter={8}>
                          <Col span={12}>
                            <Form.Item name="limit" label="数量">
                              <InputNumber min={1} max={500} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="offset" label="偏移">
                              <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Col>
                    </Row>
                    <Row align="middle" gutter={16}>
                      <Col>
                        <Form.Item name="staged" label="Staging 模式" valuePropName="checked">
                          <Switch checkedChildren="暂存审核" unCheckedChildren="直接入库" />
                        </Form.Item>
                      </Col>
                      <Col>
                        <Form.Item label=" ">
                          <Button
                            type="primary"
                            htmlType="submit"
                            icon={<ThunderboltOutlined />}
                            loading={enqueueMutation.isPending}
                          >
                            批量入队
                          </Button>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Form>
                </Card>
              </Space>
            ),
          },

          // ─── Tab 2: 任务队列 ─────────────────────────────────────────
          {
            key: 'queue',
            label: (
              <Space>
                <ClockCircleOutlined />
                任务队列
              </Space>
            ),
            children: (
              <Card
                extra={
                  <Space>
                    <Select
                      value={jobStatusFilter}
                      onChange={setJobStatusFilter}
                      placeholder="全部状态"
                      allowClear
                      style={{ width: 120 }}
                      options={[
                        { label: '等待中', value: 'waiting' },
                        { label: '处理中', value: 'active' },
                        { label: '已完成', value: 'completed' },
                        { label: '失败', value: 'failed' },
                      ]}
                    />
                    <Button
                      icon={<DeleteOutlined />}
                      loading={cleanMutation.isPending}
                      onClick={() => cleanMutation.mutate({ type: 'completed' })}
                    >
                      清理已完成
                    </Button>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={cleanMutation.isPending}
                      onClick={() => cleanMutation.mutate({ type: 'failed' })}
                    >
                      清理失败
                    </Button>
                  </Space>
                }
              >
                <Table
                  dataSource={jobs ?? []}
                  columns={jobColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                  scroll={{ x: 900 }}
                />
              </Card>
            ),
          },

          // ─── Tab 3: 暂存审核 ──────────────────────────────────────────
          {
            key: 'staged',
            label: (
              <Space>
                <ExclamationCircleOutlined />
                暂存审核
                {staged && staged.total > 0 && (
                  <Tag color="orange" style={{ marginLeft: 4 }}>
                    {staged.total}
                  </Tag>
                )}
              </Space>
            ),
            children: (
              <Card
                extra={
                  <Space>
                    <Popconfirm
                      title={`确认批量通过选中的 ${selectedRowKeys.length} 条记录？`}
                      disabled={selectedRowKeys.length === 0}
                      onConfirm={() => batchApproveMutation.mutate(selectedRowKeys as string[])}
                    >
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        disabled={selectedRowKeys.length === 0}
                        loading={batchApproveMutation.isPending}
                      >
                        批量通过 {selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : ''}
                      </Button>
                    </Popconfirm>
                    <Button icon={<ReloadOutlined />} onClick={refetchStaged}>
                      刷新
                    </Button>
                  </Space>
                }
              >
                <Alert
                  message="审核说明"
                  description="AI 置信度 < 70% 或 Staging 模式下的补全结果，需人工审核后才会写入数据库。通过=入库，拒绝=丢弃。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table<StagedEnrichment>
                  dataSource={staged?.list ?? []}
                  columns={stagedColumns}
                  rowKey="id"
                  size="small"
                  rowSelection={{
                    selectedRowKeys,
                    onChange: setSelectedRowKeys,
                  }}
                  pagination={{
                    current: stagedPage,
                    pageSize: 20,
                    total: staged?.total ?? 0,
                    onChange: setStagedPage,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
                  scroll={{ x: 900 }}
                />
              </Card>
            ),
          },

          // ─── Tab 4: 补全历史 ──────────────────────────────────────────
          {
            key: 'history',
            label: (
              <Space>
                <HistoryOutlined />
                补全历史
              </Space>
            ),
            children: (
              <Card
                extra={
                  <Button icon={<ReloadOutlined />} onClick={refetchHistory}>
                    刷新
                  </Button>
                }
              >
                <Table<StagedEnrichment>
                  dataSource={history?.list ?? []}
                  columns={historyColumns}
                  rowKey="id"
                  size="small"
                  pagination={{
                    current: historyPage,
                    pageSize: 20,
                    total: history?.total ?? 0,
                    onChange: setHistoryPage,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
                  scroll={{ x: 800 }}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* 拒绝 Modal */}
      <Modal
        title="拒绝理由"
        open={rejectModal.open}
        onCancel={() => setRejectModal({ open: false, id: '' })}
        onOk={async () => {
          const { reason } = await rejectForm.validateFields();
          rejectMutation.mutate({ id: rejectModal.id, reason });
          rejectForm.resetFields();
        }}
        confirmLoading={rejectMutation.isPending}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="拒绝原因"
            rules={[{ required: true, message: '请输入拒绝原因' }]}
          >
            <Input.TextArea rows={3} placeholder="数据不准确 / 超出合理范围 / ..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 Modal */}
      <Modal
        title="AI 补全详情"
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, record: null })}
        footer={[
          <Button key="close" onClick={() => setDetailModal({ open: false, record: null })}>
            关闭
          </Button>,
          <Popconfirm
            key="approve"
            title="确认通过此补全并入库？"
            onConfirm={() => {
              if (detailModal.record) {
                approveMutation.mutate(detailModal.record.id);
                setDetailModal({ open: false, record: null });
              }
            }}
          >
            <Button type="primary" icon={<CheckCircleOutlined />}>
              通过入库
            </Button>
          </Popconfirm>,
          <Button
            key="reject"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => {
              if (detailModal.record) {
                setDetailModal({ open: false, record: null });
                setRejectModal({ open: true, id: detailModal.record.id });
              }
            }}
          >
            拒绝
          </Button>,
        ]}
        width={700}
      >
        {detailModal.record &&
          (() => {
            const r = detailModal.record;
            const proposed = r.changes?.proposedValues ?? {};
            const { confidence, reasoning, ...fields } = proposed;
            return (
              <>
                <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="食物">
                    {r.foodName ?? r.foodId.slice(0, 8)}
                  </Descriptions.Item>
                  <Descriptions.Item label="补全目标">
                    <Tag>{r.changes?.target ?? 'foods'}</Tag>
                    {r.changes?.locale && <Tag>{r.changes.locale}</Tag>}
                    {r.changes?.region && <Tag>{r.changes.region}</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="置信度">
                    {confidence != null ? (
                      <Tag
                        color={confidence >= 0.8 ? 'green' : confidence >= 0.6 ? 'orange' : 'red'}
                      >
                        {Math.round(confidence * 100)}%
                      </Tag>
                    ) : (
                      '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="时间">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                </Descriptions>
                {reasoning && (
                  <Alert
                    message={`AI 推理：${reasoning}`}
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Divider>拟写入值（只含非空字段）</Divider>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {Object.entries(fields)
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => (
                      <Row key={k} gutter={8} style={{ marginBottom: 6 }}>
                        <Col span={8}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {FIELD_LABEL_MAP[k as EnrichableField] || k}
                          </Text>
                        </Col>
                        <Col span={16}>
                          <Tag color="blue" style={{ fontSize: 12 }}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </Tag>
                        </Col>
                      </Row>
                    ))}
                </div>
              </>
            );
          })()}
      </Modal>
    </div>
  );
};

export default EnrichmentPage;
