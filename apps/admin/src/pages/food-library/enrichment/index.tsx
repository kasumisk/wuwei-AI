import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
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
  Checkbox,
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
  EyeOutlined,
  BarChartOutlined,
  DashboardOutlined,
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
  LineChart,
  Line,
  Legend,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  useScanEnrichment,
  useEnqueueEnrichment,
  useEnrichmentStats,
  useEnrichmentJobs,
  useCleanEnrichmentJobs,
  useDrainEnrichmentQueue,
  useStagedEnrichments,
  useEnrichmentHistory,
  useApproveStaged,
  useRejectStaged,
  useBatchApproveStaged,
  useEnrichmentProgress,
  useRetryFailedEnrichment,
  useEnqueueStagedBatch,
  useCompletenessDistribution,
  useOperationsStats,
  useRollbackEnrichment,
  useBatchRollbackEnrichment,
  useReviewStats,
  type MissingFieldStats,
  type EnrichmentJob,
  type EnrichableField,
  type StagedEnrichment,
  type EnrichmentStatsResponse,
} from '@/services/foodPipelineService';
import { LOCALE_OPTIONS } from '@/pages/food-library/constants';
import { globalMessage as message } from '@/utils/message';

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
  // V8.0: V7.9 新增营养素
  { value: 'vitamin_b6', label: '维生素B6', group: '营养素' },
  { value: 'omega3', label: 'Omega-3', group: '营养素' },
  { value: 'omega6', label: 'Omega-6', group: '营养素' },
  { value: 'soluble_fiber', label: '可溶性纤维', group: '营养素' },
  { value: 'insoluble_fiber', label: '不溶性纤维', group: '营养素' },
  { value: 'water_content_percent', label: '含水率', group: '营养素' },
  // 属性
  { value: 'sub_category', label: '二级分类', group: '属性' },
  { value: 'food_group', label: '食物组', group: '属性' },
  { value: 'cuisine', label: '菜系', group: '属性' },
  { value: 'cooking_methods', label: '烹饪方式', group: '属性' },
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
  // V8.0: 扩展属性（Stage 5）
  { value: 'food_form', label: '食物形态', group: '扩展属性' },
  { value: 'dish_priority', label: '菜品优先级', group: '扩展属性' },
  { value: 'popularity_score', label: '流行度评分', group: '扩展属性' },
  { value: 'acquisition_difficulty', label: '获取难度', group: '扩展属性' },
  { value: 'texture', label: '口感质地', group: '扩展属性' },
  { value: 'taste_profile', label: '味道档案', group: '扩展属性' },
  { value: 'suitable_diet_types', label: '适合饮食类型', group: '扩展属性' },
  { value: 'health_benefits', label: '健康益处', group: '扩展属性' },
  { value: 'health_risks', label: '健康风险', group: '扩展属性' },
  { value: 'seasonal_availability', label: '季节性', group: '扩展属性' },
  { value: 'storage_method', label: '储存方式', group: '扩展属性' },
  { value: 'shelf_life_days', label: '保质期天数', group: '扩展属性' },
  { value: 'best_cooking_temp', label: '最佳烹饪温度', group: '扩展属性' },
  { value: 'pairing_foods', label: '搭配食物', group: '扩展属性' },
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
  ai_enrichment_rollback: { color: 'processing', text: '已回退' },
  ai_enrichment_rolled_back: { color: 'default', text: '原记录已回退' },
};

// ─── 组件 ─────────────────────────────────────────────────────────────────

const EnrichmentPage: React.FC = () => {
  const navigate = useNavigate();
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
  // V8.0: 详情弹窗中的字段级选择
  const [detailSelectedFields, setDetailSelectedFields] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  // V8.0: 分阶段入队参数
  const [stagedBatchStages, setStagedBatchStages] = useState<number[]>([]);
  const [stagedBatchLimit, setStagedBatchLimit] = useState(50);
  const [stagedBatchStaged, setStagedBatchStaged] = useState(false);
  const [stagedBatchMaxCompleteness, setStagedBatchMaxCompleteness] = useState<number | undefined>(
    undefined
  );
  // V8.0: 历史 Tab 行选择（用于批量回退）
  const [historySelectedRowKeys, setHistorySelectedRowKeys] = useState<React.Key[]>([]);

  // Hooks
  const { data: statsResponse, refetch: refetchStats } = useEnrichmentStats();
  const queueStats = (statsResponse as EnrichmentStatsResponse | undefined)?.queue;
  const historicalStats = (statsResponse as EnrichmentStatsResponse | undefined)?.historical;
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

  const drainMutation = useDrainEnrichmentQueue({
    onSuccess: () => {
      message.success('已清空 waiting 队列');
      refetchStats();
      refetchJobs();
    },
    onError: (e) => message.error(`清空失败: ${e.message}`),
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

  // V8.0: 全库补全进度
  const { data: enrichmentProgress } = useEnrichmentProgress();

  // V8.0: 完整度分布统计
  const { data: completenessDistribution } = useCompletenessDistribution();

  // V8.0: 运维统计
  const { data: operationsStats } = useOperationsStats();

  // V8.4: 审核细粒度报表
  const { data: reviewStats } = useReviewStats();

  // V8.0: 重试失败任务
  const retryMutation = useRetryFailedEnrichment({
    onSuccess: (data) => {
      message.success(
        `已重试 ${data.retried} 个任务${data.failedToRetry > 0 ? `，${data.failedToRetry} 个重试失败` : ''}`
      );
      refetchStats();
      refetchJobs();
    },
    onError: (e) => message.error(`重试失败: ${e.message}`),
  });

  // V8.0: 分阶段批量入队
  const stagedBatchMutation = useEnqueueStagedBatch({
    onSuccess: (data) => {
      message.success(
        `已入队 ${data.enqueued} 个任务（阶段: ${data.stageNames.join(', ')}）${data.staged ? '（Staging 模式）' : ''}`
      );
      refetchStats();
      refetchJobs();
    },
    onError: (e) => message.error(`分阶段入队失败: ${e.message}`),
  });

  // V8.0: 回退单条补全
  const rollbackMutation = useRollbackEnrichment({
    onSuccess: (data) => {
      message.success(data.rolledBack ? `回退成功: ${data.detail}` : data.detail);
      refetchHistory();
      refetchStats();
      setHistorySelectedRowKeys([]);
    },
    onError: (e) => message.error(`回退失败: ${e.message}`),
  });

  // V8.0: 批量回退补全
  const batchRollbackMutation = useBatchRollbackEnrichment({
    onSuccess: (data) => {
      message.success(`批量回退: ${data.success} 成功，${data.failed} 失败`);
      refetchHistory();
      refetchStats();
      setHistorySelectedRowKeys([]);
    },
    onError: (e) => message.error(`批量回退失败: ${e.message}`),
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
        const validEntries = Object.entries(proposed)
          .filter(([k, v]) => k !== 'confidence' && k !== 'reasoning' && v != null);
        const entries = validEntries.slice(0, 5);
        const overflow = validEntries.length - 5;
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
            {overflow > 0 && <Tag>+{overflow}</Tag>}
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
      width: 200,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/food-library/enrichment/preview/${r.id}`)}
          >
            预览
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => setDetailModal({ open: true, record: r })}
          >
            详情
          </Button>
          <Popconfirm
            title="确认通过此补全并入库？"
            onConfirm={() => approveMutation.mutate({ id: r.id })}
          >
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
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/food-library/detail/${r.foodId}`)}
          >
            <Text strong style={{ fontSize: 13 }}>
              {r.foodName ?? '-'}
            </Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {r.foodId.slice(0, 8)}
            </Text>
          </Button>
        </Space>
      ),
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      width: 120,
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
    {
      title: '操作',
      key: 'action_ops',
      width: 100,
      render: (_, r) => {
        // 仅"已入库"和"已审核通过"的记录可回退
        const canRollback = r.action === 'ai_enrichment' || r.action === 'ai_enrichment_approved';
        if (!canRollback) return '-';
        return (
          <Popconfirm
            title="确认回退此补全？"
            description="将清除该次补全写入的字段值，使食物可重新进行 AI 补全。"
            onConfirm={() => rollbackMutation.mutate(r.id)}
          >
            <Button type="link" danger size="small" loading={rollbackMutation.isPending}>
              回退
            </Button>
          </Popconfirm>
        );
      },
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
        {historicalStats && (
          <Col xs={12} sm={8} md={4}>
            <Card size="small">
              <Statistic
                title="平均完整度"
                value={historicalStats.avgCompleteness}
                suffix="%"
                valueStyle={{
                  color: historicalStats.avgCompleteness >= 60 ? '#52c41a' : '#faad14',
                  fontSize: 22,
                }}
              />
            </Card>
          </Col>
        )}
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

      {/* V8.0: 全库补全进度 */}
      {enrichmentProgress && (
        <Card
          size="small"
          title="全库补全进度"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Tag color="blue">平均完整度: {enrichmentProgress.avgCompleteness}%</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {enrichmentProgress.totalFoods} 条食物
              </Text>
            </Space>
          }
        >
          {/* 汇总数字 */}
          <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
            <Col xs={8} sm={6} md={4}>
              <Statistic
                title="完整度 ≥80%"
                value={enrichmentProgress.fullyEnriched}
                valueStyle={{ color: '#52c41a', fontSize: 20 }}
              />
            </Col>
            <Col xs={8} sm={6} md={4}>
              <Statistic
                title="40%~80%"
                value={enrichmentProgress.partiallyEnriched}
                valueStyle={{ color: '#fa8c16', fontSize: 20 }}
              />
            </Col>
            <Col xs={8} sm={6} md={4}>
              <Statistic
                title="未补全 <40%"
                value={enrichmentProgress.notEnriched}
                valueStyle={{ color: '#ff4d4f', fontSize: 20 }}
              />
            </Col>
          </Row>
          {/* 各阶段覆盖率 */}
          <Row gutter={[16, 8]}>
            {enrichmentProgress.stagesCoverage.map((stage) => {
              const pct = stage.coverageRate;
              return (
                <Col xs={24} sm={12} md={8} key={stage.stage}>
                  <div style={{ marginBottom: 4 }}>
                    <Row justify="space-between">
                      <Text style={{ fontSize: 12 }}>
                        阶段{stage.stage}：{stage.name}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {pct}%
                      </Text>
                    </Row>
                    <Progress
                      percent={pct}
                      size="small"
                      strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
                    />
                  </div>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}

      {/* V8.0: 完整度分布统计 */}
      {completenessDistribution && (
        <Card
          size="small"
          title={
            <Space>
              <BarChartOutlined />
              全库完整度分布
            </Space>
          }
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Tag color="blue">
                平均完整度: {Math.round(completenessDistribution.avgCompleteness)}%
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {completenessDistribution.total} 条食物
              </Text>
            </Space>
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={completenessDistribution.distribution.map((d) => ({
                name: d.range,
                count: d.count,
                percentage:
                  completenessDistribution.total > 0
                    ? Math.round((d.count / completenessDistribution.total) * 100)
                    : 0,
              }))}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <RechartsTooltip
                formatter={
                  ((value: number, _name: string, props: { payload?: { percentage?: number } }) =>
                    [`${value} 条 (${props.payload?.percentage ?? 0}%)`, '食物数量'] as any) as any
                }
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {completenessDistribution.distribution.map((_entry, index) => {
                  // 完整度越高颜色越绿，越低越红
                  const colors = ['#ff4d4f', '#fa8c16', '#faad14', '#52c41a', '#389e0d'];
                  return <Cell key={`cell-${index}`} fill={colors[index] ?? '#1677ff'} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

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
                          <Col span={8}>
                            <Form.Item name="limit" label="数量">
                              <InputNumber min={1} max={500} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="offset" label="偏移">
                              <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item
                              name="maxCompleteness"
                              label="最高完整度"
                              tooltip="仅入队完整度 <= 此值的食物（0-100），留空不限"
                            >
                              <InputNumber
                                min={0}
                                max={100}
                                placeholder="不限"
                                style={{ width: '100%' }}
                              />
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

                {/* V8.0: 分阶段批量入队 */}
                <Card
                  title={
                    <Space>
                      <ThunderboltOutlined />
                      分阶段智能入队
                    </Space>
                  }
                >
                  <Alert
                    message="分阶段补全策略"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>
                          <strong>阶段 1</strong>：核心宏量营养素（蛋白质、脂肪、碳水、热量）
                        </li>
                        <li>
                          <strong>阶段 2</strong>：微量营养素（维生素、矿物质）
                        </li>
                        <li>
                          <strong>阶段 3</strong>：健康属性（GI、GL、FODMAP、加工程度等）
                        </li>
                        <li>
                          <strong>阶段 4</strong>：标签与评分（餐次、过敏原、饱腹感等）
                        </li>
                        <li>建议按顺序逐阶段补全，确保数据质量</li>
                      </ul>
                    }
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Row gutter={16} align="bottom">
                    <Col xs={24} sm={8}>
                      <Form.Item label="选择阶段" style={{ marginBottom: 8 }}>
                        <Select
                          mode="multiple"
                          placeholder="不选则按顺序自动选择"
                          value={stagedBatchStages}
                          onChange={setStagedBatchStages}
                          options={[
                            { label: '阶段 1: 核心营养素', value: 1 },
                            { label: '阶段 2: 微量营养素', value: 2 },
                            { label: '阶段 3: 健康属性', value: 3 },
                            { label: '阶段 4: 标签评分', value: 4 },
                            { label: '阶段 5: 扩展属性', value: 5 },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item label="数量" style={{ marginBottom: 8 }}>
                        <InputNumber
                          min={1}
                          max={500}
                          value={stagedBatchLimit}
                          onChange={(v) => setStagedBatchLimit(v ?? 50)}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item
                        label="最高完整度"
                        tooltip="仅入队完整度 <= 此值的食物（0-100），留空不限"
                        style={{ marginBottom: 8 }}
                      >
                        <InputNumber
                          min={0}
                          max={100}
                          placeholder="不限"
                          value={stagedBatchMaxCompleteness}
                          onChange={(v) => setStagedBatchMaxCompleteness(v ?? undefined)}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item label="Staging 模式" style={{ marginBottom: 8 }}>
                        <Switch
                          checked={stagedBatchStaged}
                          onChange={setStagedBatchStaged}
                          checkedChildren="暂存审核"
                          unCheckedChildren="直接入库"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item label=" " style={{ marginBottom: 8 }}>
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={stagedBatchMutation.isPending}
                          onClick={() =>
                            stagedBatchMutation.mutate({
                              stages: stagedBatchStages.length > 0 ? stagedBatchStages : undefined,
                              limit: stagedBatchLimit,
                              staged: stagedBatchStaged,
                              maxCompleteness: stagedBatchMaxCompleteness,
                            })
                          }
                        >
                          分阶段入队
                        </Button>
                      </Form.Item>
                    </Col>
                  </Row>
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
                    <Popconfirm
                      title="重试失败任务"
                      description="将自动重新入队所有失败的补全任务"
                      onConfirm={() => retryMutation.mutate({ limit: 100 })}
                    >
                      <Button
                        icon={<ReloadOutlined />}
                        loading={retryMutation.isPending}
                        disabled={!queueStats || (queueStats as any).failed === 0}
                      >
                        重试失败
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="清空 waiting 队列"
                      description={`将移除所有等待中的任务（当前 ${queueStats?.waiting ?? 0} 个），正在执行的任务不受影响。`}
                      onConfirm={() => drainMutation.mutate()}
                      okText="确认清空"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        loading={drainMutation.isPending}
                        disabled={!queueStats || (queueStats as any).waiting === 0}
                      >
                        清空 waiting
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="清理全部已结束任务"
                      description="一次性清理所有 completed 和 failed 状态的任务记录。"
                      onConfirm={() => cleanMutation.mutate({ type: 'all', limit: 9999 } as any)}
                      okText="确认清理"
                      okButtonProps={{ danger: true }}
                    >
                      <Button danger icon={<DeleteOutlined />} loading={cleanMutation.isPending}>
                        清理全部
                      </Button>
                    </Popconfirm>
                  </Space>
                }
              >
                <Table
                  dataSource={jobs?.list ?? []}
                  columns={jobColumns}
                  rowKey="id"
                  size="small"
                  pagination={{
                    pageSize: 20,
                    total: jobs?.total,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
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
                    <Button icon={<ReloadOutlined />} onClick={() => refetchStaged()}>
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
                  <Space>
                    <Popconfirm
                      title={`确认批量回退选中的 ${historySelectedRowKeys.length} 条记录？`}
                      description="将清除这些补全写入的字段值，使对应食物可重新进行 AI 补全。"
                      disabled={historySelectedRowKeys.length === 0}
                      onConfirm={() =>
                        batchRollbackMutation.mutate(historySelectedRowKeys as string[])
                      }
                    >
                      <Button
                        danger
                        icon={<CloseCircleOutlined />}
                        disabled={historySelectedRowKeys.length === 0}
                        loading={batchRollbackMutation.isPending}
                      >
                        批量回退{' '}
                        {historySelectedRowKeys.length > 0
                          ? `(${historySelectedRowKeys.length})`
                          : ''}
                      </Button>
                    </Popconfirm>
                    <Button icon={<ReloadOutlined />} onClick={() => refetchHistory()}>
                      刷新
                    </Button>
                  </Space>
                }
              >
                <Alert
                  message="回退说明"
                  description="选择已入库或已审核通过的补全记录，点击回退后将清除该次补全写入的字段值，使食物回到待补全状态。回退操作会写入审计日志。"
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table<StagedEnrichment>
                  dataSource={history?.list ?? []}
                  columns={historyColumns}
                  rowKey="id"
                  size="small"
                  rowSelection={{
                    selectedRowKeys: historySelectedRowKeys,
                    onChange: setHistorySelectedRowKeys,
                    getCheckboxProps: (record) => ({
                      // 仅"已入库"和"已审核通过"的可选中
                      disabled:
                        record.action !== 'ai_enrichment' &&
                        record.action !== 'ai_enrichment_approved',
                    }),
                  }}
                  pagination={{
                    current: historyPage,
                    pageSize: 20,
                    total: history?.total ?? 0,
                    onChange: setHistoryPage,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
                  scroll={{ x: 1000 }}
                />
              </Card>
            ),
          },

          // ─── Tab 5: 运维统计 ──────────────────────────────────────────
          {
            key: 'ops',
            label: (
              <Space>
                <DashboardOutlined />
                运维统计
              </Space>
            ),
            children: operationsStats ? (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                {/* 概览卡片 */}
                <Row gutter={[12, 12]}>
                  {[
                    {
                      label: '总补全次数',
                      value: operationsStats.total,
                      color: '#1677ff',
                    },
                    {
                      label: '直接入库',
                      value: operationsStats.directApplied,
                      color: '#52c41a',
                    },
                    {
                      label: '暂存待审',
                      value: operationsStats.staged,
                      color: '#fa8c16',
                    },
                    {
                      label: '审核通过',
                      value: operationsStats.approved,
                      color: '#389e0d',
                    },
                    {
                      label: '审核拒绝',
                      value: operationsStats.rejected,
                      color: '#ff4d4f',
                    },
                    {
                      label: '审核通过率',
                      value: operationsStats.approvalRate,
                      suffix: '%',
                      color: '#722ed1',
                    },
                    {
                      label: '平均置信度',
                      value: Math.round(operationsStats.avgConfidence * 100),
                      suffix: '%',
                      color: '#13c2c2',
                    },
                  ].map(({ label, value, color, suffix }) => (
                    <Col xs={12} sm={8} md={6} lg={4} key={label}>
                      <Card size="small">
                        <Statistic
                          title={label}
                          value={value}
                          suffix={suffix}
                          valueStyle={{ color, fontSize: 20 }}
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>

                {/* 近30天趋势折线图 */}
                <Card
                  size="small"
                  title="近 30 天补全趋势"
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      按操作类型分组统计
                    </Text>
                  }
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={(() => {
                        // 将 dailyStats 按日期聚合为折线图数据
                        const byDate: Record<string, Record<string, number>> = {};
                        for (const item of operationsStats.dailyStats) {
                          if (!byDate[item.date]) byDate[item.date] = {};
                          byDate[item.date][item.action] = item.count;
                        }
                        return Object.entries(byDate)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([date, actions]) => ({
                            date: date.slice(5), // MM-DD
                            已入库: actions['ai_enrichment'] ?? 0,
                            待审核: actions['ai_enrichment_staged'] ?? 0,
                            已通过: actions['ai_enrichment_approved'] ?? 0,
                            已拒绝: actions['ai_enrichment_rejected'] ?? 0,
                          }));
                      })()}
                      margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="已入库"
                        stroke="#52c41a"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="待审核"
                        stroke="#fa8c16"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="已通过"
                        stroke="#389e0d"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="已拒绝"
                        stroke="#ff4d4f"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>

                {/* ── V8.4 审核统计报表 ── */}
                {reviewStats && (
                  <>
                    <Divider orientation="left" style={{ marginTop: 8 }}>
                      审核统计报表
                    </Divider>

                    {/* 审核概览数字卡 */}
                    <Row gutter={[12, 12]}>
                      {[
                        { label: '待审核积压', value: reviewStats.pendingReview, color: '#fa8c16' },
                        { label: '历史已通过', value: reviewStats.approved, color: '#52c41a' },
                        { label: '历史已拒绝', value: reviewStats.rejected, color: '#ff4d4f' },
                        {
                          label: '审核通过率',
                          value: reviewStats.approvalRate,
                          suffix: '%',
                          color: '#722ed1',
                        },
                        {
                          label: '审核拒绝率',
                          value: reviewStats.rejectionRate,
                          suffix: '%',
                          color: '#f5222d',
                        },
                        {
                          label: '综合平均置信度',
                          value: Math.round(reviewStats.avgConfidenceAll * 100),
                          suffix: '%',
                          color: '#13c2c2',
                        },
                        {
                          label: '通过记录置信度',
                          value: Math.round(reviewStats.avgConfidenceApproved * 100),
                          suffix: '%',
                          color: '#389e0d',
                        },
                        {
                          label: '拒绝记录置信度',
                          value: Math.round(reviewStats.avgConfidenceRejected * 100),
                          suffix: '%',
                          color: '#d4380d',
                        },
                      ].map(({ label, value, color, suffix }) => (
                        <Col xs={12} sm={8} md={6} lg={3} key={label}>
                          <Card size="small">
                            <Statistic
                              title={label}
                              value={value}
                              suffix={suffix}
                              valueStyle={{ color, fontSize: 18 }}
                            />
                          </Card>
                        </Col>
                      ))}
                    </Row>

                    {/* 置信度区间分布柱状图 + 近30天通过/拒绝趋势 */}
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={12}>
                        <Card size="small" title="置信度区间分布（已审核记录）">
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart
                              data={reviewStats.confidenceBuckets}
                              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Bar
                                dataKey="approved"
                                name="已通过"
                                fill="#52c41a"
                                radius={[3, 3, 0, 0]}
                              />
                              <Bar
                                dataKey="rejected"
                                name="已拒绝"
                                fill="#ff4d4f"
                                radius={[3, 3, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </Card>
                      </Col>
                      <Col xs={24} md={12}>
                        <Card size="small" title="近 30 天审核趋势">
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart
                              data={[...reviewStats.dailyTrend]
                                .sort((a, b) => a.date.localeCompare(b.date))
                                .map((d) => ({ ...d, date: d.date.slice(5) }))}
                              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Line
                                type="monotone"
                                dataKey="approved"
                                name="已通过"
                                stroke="#52c41a"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="rejected"
                                name="已拒绝"
                                stroke="#ff4d4f"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </Card>
                      </Col>
                    </Row>

                    {/* 待审核积压列表 */}
                    {reviewStats.pendingList.length > 0 && (
                      <Card
                        size="small"
                        title={
                          <Space>
                            <span>待审核积压（最近 20 条）</span>
                            <Tag color="orange">{reviewStats.pendingReview} 条待审核</Tag>
                          </Space>
                        }
                      >
                        <Table
                          size="small"
                          rowKey="logId"
                          pagination={false}
                          dataSource={reviewStats.pendingList}
                          columns={[
                            {
                              title: '食物',
                              dataIndex: 'foodName',
                              width: 160,
                              ellipsis: true,
                            },
                            {
                              title: '补全字段数',
                              dataIndex: 'enrichedFields',
                              width: 90,
                              align: 'center',
                              render: (fields: string[]) => (
                                <Tag color="blue">{fields.length} 个字段</Tag>
                              ),
                            },
                            {
                              title: '置信度',
                              dataIndex: 'confidence',
                              width: 90,
                              align: 'center',
                              render: (v: number | null) =>
                                v != null ? (
                                  <Tag color={v >= 0.7 ? 'green' : v >= 0.5 ? 'orange' : 'red'}>
                                    {Math.round(v * 100)}%
                                  </Tag>
                                ) : (
                                  <Text type="secondary">—</Text>
                                ),
                            },
                            {
                              title: '入队时间',
                              dataIndex: 'createdAt',
                              width: 150,
                              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                            },
                            {
                              title: '操作',
                              width: 80,
                              render: (_: any, record: { logId: string }) => (
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() =>
                                    navigate(`/food-library/enrichment/preview/${record.logId}`)
                                  }
                                >
                                  预览
                                </Button>
                              ),
                            },
                          ]}
                        />
                      </Card>
                    )}
                  </>
                )}
              </Space>
            ) : (
              <Card>
                <Alert message="加载中..." type="info" showIcon />
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
        onCancel={() => {
          setDetailModal({ open: false, record: null });
          setDetailSelectedFields([]);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setDetailModal({ open: false, record: null });
              setDetailSelectedFields([]);
            }}
          >
            关闭
          </Button>,
          <Popconfirm
            key="approve"
            title={
              detailSelectedFields.length > 0
                ? `确认将选中的 ${detailSelectedFields.length} 个字段入库？`
                : '确认通过全部字段并入库？'
            }
            onConfirm={() => {
              if (detailModal.record) {
                approveMutation.mutate({
                  id: detailModal.record.id,
                  selectedFields:
                    detailSelectedFields.length > 0 ? detailSelectedFields : undefined,
                });
                setDetailModal({ open: false, record: null });
                setDetailSelectedFields([]);
              }
            }}
          >
            <Button type="primary" icon={<CheckCircleOutlined />}>
              {detailSelectedFields.length > 0
                ? `选择性入库 (${detailSelectedFields.length})`
                : '全部通过'}
            </Button>
          </Popconfirm>,
          <Button
            key="reject"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => {
              if (detailModal.record) {
                setDetailModal({ open: false, record: null });
                setDetailSelectedFields([]);
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
            const fieldEntries = Object.entries(fields).filter(([, v]) => v != null);
            const allFieldKeys = fieldEntries.map(([k]) => k);
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
                <Divider>拟写入值（勾选字段选择性入库，不勾选则全部入库）</Divider>
                <div style={{ marginBottom: 8 }}>
                  <Space>
                    <Button size="small" onClick={() => setDetailSelectedFields(allFieldKeys)}>
                      全选
                    </Button>
                    <Button size="small" onClick={() => setDetailSelectedFields([])}>
                      全不选
                    </Button>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {detailSelectedFields.length > 0
                        ? `已选 ${detailSelectedFields.length} / ${allFieldKeys.length} 个字段`
                        : '未选择（将入库全部字段）'}
                    </Text>
                  </Space>
                </div>
                <Checkbox.Group
                  value={detailSelectedFields}
                  onChange={(vals) => setDetailSelectedFields(vals as string[])}
                  style={{ width: '100%' }}
                >
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {fieldEntries.map(([k, v]) => (
                      <Row
                        key={k}
                        gutter={8}
                        style={{
                          marginBottom: 6,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: detailSelectedFields.includes(k) ? '#f0f5ff' : 'transparent',
                        }}
                        align="middle"
                      >
                        <Col span={2}>
                          <Checkbox value={k} />
                        </Col>
                        <Col span={8}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {FIELD_LABEL_MAP[k as EnrichableField] || k}
                          </Text>
                        </Col>
                        <Col span={14}>
                          <Tag color="blue" style={{ fontSize: 12 }}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </Tag>
                        </Col>
                      </Row>
                    ))}
                  </div>
                </Checkbox.Group>
              </>
            );
          })()}
      </Modal>
    </div>
  );
};

export default EnrichmentPage;
