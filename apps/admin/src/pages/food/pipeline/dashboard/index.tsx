import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  message,
  Progress,
  Tag,
  Descriptions,
  Spin,
  Typography,
  Input,
  InputNumber,
  Select,
  Modal,
  Form,
  Alert,
  Switch,
  Table,
} from 'antd';
import {
  CloudDownloadOutlined,
  RobotOutlined,
  TranslationOutlined,
  CalculatorOutlined,
  WarningOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  BarcodeOutlined,
} from '@ant-design/icons';
import {
  useQualityReport,
  useImportUsda,
  useBatchAiLabel,
  useBatchAiTranslate,
  useBatchApplyRules,
  useBackfillNutrientScores,
  usePromoteCandidates,
  useBatchEnrichByStage,
  useCheckConsistency,
  useEnrichmentStatistics,
  useResolveAllConflicts,
  useLookupBarcode,
} from '@/services/foodPipelineService';
import { foodLibraryApi } from '@/services/foodLibraryService';

export const routeConfig = {
  name: 'pipeline-dashboard',
  title: '管道总览',
  icon: 'DashboardOutlined',
  order: 1,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

const formatPercent = (value: number) => `${Math.round(value)}%`;

const getStepTone = (status: 'done' | 'in_progress' | 'todo' | 'warning') => {
  if (status === 'done') return { color: 'green', label: '已完成' };
  if (status === 'in_progress') return { color: 'blue', label: '进行中' };
  if (status === 'warning') return { color: 'orange', label: '需处理' };
  return { color: 'default', label: '待开始' };
};

const PipelineDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: report, isLoading, refetch } = useQualityReport();
  const [usdaModal, setUsdaModal] = useState(false);
  const [barcodeModal, setBarcodeModal] = useState(false);
  const [aiLabelModal, setAiLabelModal] = useState(false);
  const [translateModal, setTranslateModal] = useState(false);
  const [backfillModal, setBackfillModal] = useState(false);
  const [candidateModal, setCandidateModal] = useState(false);
  const [stageModal, setStageModal] = useState(false);
  const [consistencyModal, setConsistencyModal] = useState(false);
  const [statsModal, setStatsModal] = useState(false);
  const [consistencyOptions, setConsistencyOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [consistencySearching, setConsistencySearching] = useState(false);
  const consistencySearchSeq = useRef(0);

  const [usdaForm] = Form.useForm();
  const [aiLabelForm] = Form.useForm();
  const [translateForm] = Form.useForm();
  const [backfillForm] = Form.useForm();
  const [candidateForm] = Form.useForm();
  const [stageForm] = Form.useForm();
  const [consistencyForm] = Form.useForm();
  const [barcodeValue, setBarcodeValue] = useState('');

  const importUsda = useImportUsda({
    onSuccess: (result) => {
      message.success(
        `导入完成: 新增 ${result.created}, 更新 ${result.updated}, 跳过 ${result.skipped}`
      );
      setUsdaModal(false);
      usdaForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`导入失败: ${e.message}`),
  });

  const batchLabel = useBatchAiLabel({
    onSuccess: (result) => {
      message.success(`标注完成: 成功 ${result.labeled}, 失败 ${result.failed}`);
      setAiLabelModal(false);
      aiLabelForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`标注失败: ${e.message}`),
  });

  const batchTranslate = useBatchAiTranslate({
    onSuccess: (result) => {
      message.success(`翻译完成: 成功 ${result.translated}, 失败 ${result.failed}`);
      setTranslateModal(false);
      translateForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`翻译失败: ${e.message}`),
  });

  const batchRules = useBatchApplyRules({
    onSuccess: (result) => {
      message.success(`规则计算完成: 处理了 ${result.processed} 条`);
      refetch();
    },
    onError: (e) => message.error(`规则计算失败: ${e.message}`),
  });

  const backfillScores = useBackfillNutrientScores({
    onSuccess: (result) => {
      message.success(`评分回填完成: 更新 ${result.updated}/${result.total}, 错误 ${result.errors}`);
      setBackfillModal(false);
      refetch();
    },
    onError: (e) => message.error(`评分回填失败: ${e.message}`),
  });

  const promoteCandidates = usePromoteCandidates({
    onSuccess: (result) => {
      message.success(`候选晋升完成: 成功 ${result.promoted}, 重复 ${result.duplicates}, 错误 ${result.errors}`);
      setCandidateModal(false);
      refetch();
    },
    onError: (e) => message.error(`候选晋升失败: ${e.message}`),
  });

  const batchEnrichStage = useBatchEnrichByStage({
    onSuccess: (result) => {
      message.success(`分阶段补全完成: 处理 ${result.processed} 条, 补全 ${result.totalEnriched} 个字段`);
      setStageModal(false);
      refetch();
    },
    onError: (e) => message.error(`分阶段补全失败: ${e.message}`),
  });

  const consistencyCheck = useCheckConsistency({
    onSuccess: () => {
      message.success('一致性校验完成');
    },
    onError: (e) => message.error(`一致性校验失败: ${e.message}`),
  });

  const enrichmentStats = useEnrichmentStatistics({
    onSuccess: () => setStatsModal(true),
    onError: (e) => message.error(`获取补全统计失败: ${e.message}`),
  });

  const handleConsistencySearch = async (keyword: string) => {
    const trimmed = keyword.trim();
    const currentSeq = ++consistencySearchSeq.current;

    if (!trimmed) {
      setConsistencyOptions([]);
      return;
    }

    setConsistencySearching(true);
    try {
      const result = await foodLibraryApi.getList({
        keyword: trimmed,
        page: 1,
        pageSize: 20,
      });

      if (currentSeq !== consistencySearchSeq.current) {
        return;
      }

      setConsistencyOptions(
        result.list.map((food) => ({
          value: food.id,
          label: `${food.name} [${food.id}]`,
        }))
      );
    } catch {
      if (currentSeq === consistencySearchSeq.current) {
        setConsistencyOptions([]);
      }
    } finally {
      if (currentSeq === consistencySearchSeq.current) {
        setConsistencySearching(false);
      }
    }
  };

  const resolveConflicts = useResolveAllConflicts({
    onSuccess: () => {
      message.success('冲突自动解决完成');
      refetch();
    },
    onError: (e) => message.error(`冲突解决失败: ${e.message}`),
  });

  const lookupBarcode = useLookupBarcode({
    onSuccess: (data) => {
      message.success(`条形码查询成功: ${data?.name || '已导入'}`);
      setBarcodeModal(false);
      setBarcodeValue('');
      refetch();
    },
    onError: (e) => message.error(`条形码查询失败: ${e.message}`),
  });

  if (isLoading) {
    return (
      <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />
    );
  }

  // 直接从 report 顶层取字段（后端不再包装 summary）
  const totalFoods = report?.totalFoods ?? 0;
  const completeness = report?.completeness;
  const quality = report?.quality;
  const conflicts = report?.conflicts;
  const translations = report?.translations;
  const tagCoverage = totalFoods ? ((completeness?.withTags || 0) / totalFoods) * 100 : 0;
  const translationCoverage = totalFoods
    ? (((translations?.foodsWithTranslation || 0) / totalFoods) * 100)
    : 0;
  const macroConsistency = totalFoods
    ? (((totalFoods - (quality?.macroInconsistent || 0)) / totalFoods) * 100)
    : 0;
  const verifiedCoverage = totalFoods ? (((quality?.verified || 0) / totalFoods) * 100) : 0;

  const pipelineSteps = [
    {
      key: 'ingest',
      index: '01',
      title: '导入原始数据',
      summary: '先把食物拉进库，后面步骤才有对象可处理。',
      whenToUse: '首次建库、补充新品类、需要新增条形码商品时。',
      skipWhen: '库里已经有目标食物，且这次不需要新增数据源时。',
      doneRule: '食物总量 > 0，且本轮目标食物已经能在食物库中搜到。',
      commonIssues: '常见问题：导入后搜不到食物，通常是关键词太窄、条形码无结果，或源数据被清洗阶段丢弃。',
      solutionTip: '解决建议：先放宽关键词或更换英文同义词；条形码场景优先确认 Open Food Facts 是否有该商品；如果导入数量异常偏少，再去看质量报告和清洗日志。',
      example: '例子：你想新增“chicken breast”或录入一包零食条形码，就先做这一步。',
      detailPath: '/food/pipeline/usda-import',
      detailLabel: '查看导入页',
      metric: `${totalFoods} 条食物`,
      status: totalFoods > 0 ? 'done' : 'todo' as const,
      actions: (
        <Space wrap>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setUsdaModal(true)}>
            USDA 导入
          </Button>
          <Button icon={<BarcodeOutlined />} onClick={() => setBarcodeModal(true)}>
            条形码查询
          </Button>
        </Space>
      ),
    },
    {
      key: 'label',
      index: '02',
      title: '补全分类和标签',
      summary: '让食物具备分类、标签、过敏原、餐次等结构化信息。',
      whenToUse: '标签覆盖率低、推荐过滤条件不够用、导入后信息太“生”时。',
      skipWhen: '标签、过敏原、餐次已经足够完整，不需要再补结构字段时。',
      doneRule: '标签覆盖率建议达到 80% 以上，重点分类食物具备标签和餐次信息。',
      commonIssues: '常见问题：AI 标注跑完覆盖率还是低，通常是目标分类太窄、limit 太小，或历史数据本身缺少可推断上下文。',
      solutionTip: '解决建议：先扩大 limit，再去掉分类过滤重跑；如果仍然偏低，优先改用“分阶段补全”补结构字段，再回头跑 AI 标注。',
      example: '例子：导入了一批米饭和肉类，但还没有“高蛋白”“早餐适合”这类标签，就跑这一步。',
      detailPath: '/food/pipeline/ai-label',
      detailLabel: '查看标注页',
      metric: `标签覆盖 ${formatPercent(tagCoverage)}`,
      status: tagCoverage >= 80 ? 'done' : tagCoverage > 0 ? 'in_progress' : 'todo' as const,
      actions: (
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => setAiLabelModal(true)}>
            AI 标注
          </Button>
          <Button onClick={() => setStageModal(true)}>分阶段补全</Button>
        </Space>
      ),
    },
    {
      key: 'translation',
      index: '03',
      title: '补全多语言',
      summary: '给 App / Web 提供可直接展示的多语言名称和描述。',
      whenToUse: '要给英文/多语言端展示、运营要检查本地化文本时。',
      skipWhen: '当前只服务单语言场景，或目标语言已覆盖到位时。',
      doneRule: '目标语言覆盖率建议达到 80% 以上，至少核心食物有翻译。',
      commonIssues: '常见问题：翻译成功率低，多半是批量太大、目标语言过多，或食物基础名称本身不规范。',
      solutionTip: '解决建议：先只翻译一个目标语言并缩小批量；对命名明显混乱的食物，先补分类/标签再翻译。',
      example: '例子：你希望英文端能展示 “鸡胸肉 / broccoli / yogurt” 的英文名，就先做这一步。',
      detailPath: '/food/pipeline/translation',
      detailLabel: '查看翻译页',
      metric: `翻译覆盖 ${formatPercent(translationCoverage)}`,
      status:
        translationCoverage >= 80 ? 'done' : translationCoverage > 0 ? 'in_progress' : 'todo',
      actions: (
        <Button type="primary" icon={<TranslationOutlined />} onClick={() => setTranslateModal(true)}>
          AI 翻译
        </Button>
      ),
    },
    {
      key: 'score',
      index: '04',
      title: '计算评分与回填',
      summary: '把评分、营养密度和历史缺失值补齐，给推荐和分析使用。',
      whenToUse: '导入/标注后需要刷新评分，或者历史数据没有 health assessment 时。',
      skipWhen: '评分已经最新，且没有历史缺失记录需要回填时。',
      doneRule: '关键食物已有 qualityScore、satietyScore、nutrientDensity，可支持推荐与分析。',
      commonIssues: '常见问题：评分不变或回填数量很少，通常说明该批数据已有评分，或者上游营养字段还不够完整。',
      solutionTip: '解决建议：新数据先跑“计算评分”；历史缺口再跑“回填评分”；如果结果仍少，先回头补宏量/标签/GI 等上游字段。',
      example: '例子：你刚导入一批食物，想马上让推荐系统用到 qualityScore，就做这一步。',
      detailPath: '/food/pipeline/scoring',
      detailLabel: '查看评分页',
      metric: `已验证 ${formatPercent(verifiedCoverage)}`,
      status: verifiedCoverage >= 70 ? 'done' : verifiedCoverage > 0 ? 'in_progress' : 'todo',
      actions: (
        <Space wrap>
          <Button type="primary" icon={<CalculatorOutlined />} onClick={() => batchRules.mutate({ recalcAll: false })}>
            计算评分
          </Button>
          <Button onClick={() => setBackfillModal(true)}>回填评分</Button>
        </Space>
      ),
    },
    {
      key: 'quality',
      index: '05',
      title: '处理冲突与质检',
      summary: '最后看冲突、异常值和补全统计，确认数据能稳定使用。',
      whenToUse: '导入完成后验收质量、发现异常营养值、或要核对补全效果时。',
      skipWhen: '当前没有待处理冲突，且质检指标都稳定在可接受范围时。',
      doneRule: '待处理冲突尽量为 0，宏量一致性建议 > 80%，异常值已核查。',
      commonIssues: '常见问题：冲突长期堆积，通常是多来源字段差异太大，或导入后没有及时跑统一评分和质检。',
      solutionTip: '解决建议：先批量自动解决冲突，再用一致性校验查单条异常；如果冲突继续增长，回头检查导入源优先级和重复合并策略。',
      example: '例子：同一个食物来自 USDA 和 Open Food Facts 的热量差很多，或者某条数据明显离谱，就做这一步。',
      detailPath: '/food/pipeline/quality-monitor',
      detailLabel: '查看质检页',
      metric: `待处理冲突 ${conflicts?.pending || 0} 条`,
      status:
        (conflicts?.pending || 0) > 0
          ? 'warning'
          : macroConsistency >= 80
            ? 'done'
            : 'in_progress',
      actions: (
        <Space wrap>
          <Button danger icon={<WarningOutlined />} onClick={() => resolveConflicts.mutate()}>
            自动解决冲突
          </Button>
          <Button onClick={() => setConsistencyModal(true)}>一致性校验</Button>
          <Button onClick={() => enrichmentStats.mutate()}>补全统计</Button>
        </Space>
      ),
    },
  ];

  const nextAction =
    totalFoods === 0
      ? {
          step: '步骤 01 导入原始数据',
          reason: '当前食物库还是空的，后续标注、翻译和评分都没有处理对象。',
          actionLabel: '去导入数据',
          action: () => setUsdaModal(true),
        }
      : tagCoverage < 80
        ? {
            step: '步骤 02 补全分类和标签',
            reason: `当前标签覆盖率只有 ${formatPercent(tagCoverage)}，会直接影响推荐过滤、过敏原识别和餐次判断。`,
            actionLabel: '去做 AI 标注',
            action: () => setAiLabelModal(true),
          }
        : translationCoverage < 80
          ? {
              step: '步骤 03 补全多语言',
              reason: `当前翻译覆盖率只有 ${formatPercent(translationCoverage)}，多语言端展示会不完整。`,
              actionLabel: '去做 AI 翻译',
              action: () => setTranslateModal(true),
            }
          : verifiedCoverage < 70
            ? {
                step: '步骤 04 计算评分与回填',
                reason: `当前已验证覆盖率只有 ${formatPercent(verifiedCoverage)}，建议先刷新评分和历史缺失值。`,
                actionLabel: '去计算评分',
                action: () => batchRules.mutate({ recalcAll: false }),
              }
            : (conflicts?.pending || 0) > 0 || macroConsistency < 80
              ? {
                  step: '步骤 05 处理冲突与质检',
                  reason: `当前有 ${conflicts?.pending || 0} 条待处理冲突，宏量一致性为 ${formatPercent(macroConsistency)}，建议先做质检。`,
                  actionLabel: '去处理冲突',
                  action: () => resolveConflicts.mutate(),
                }
              : {
                  step: '当前流程已基本健康',
                  reason: '核心覆盖率和质检指标都已达标，后续主要按需导入新数据或做抽样复查。',
                  actionLabel: '查看补全统计',
                  action: () => enrichmentStats.mutate(),
                };

  return (
    <div style={{ padding: 0 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="先按流程走，再看高级工具"
        description="建议顺序：1. 导入数据 -> 2. AI 标注 -> 3. AI 翻译 -> 4. 计算评分/回填 -> 5. 处理冲突和做质检。下面每张卡都告诉你这一步的目的、当前状态和直接操作入口。"
      />

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={`建议下一步：${nextAction.step}`}
        description={
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>{nextAction.reason}</Text>
            <Space>
              <Button type="primary" size="small" onClick={nextAction.action}>
                {nextAction.actionLabel}
              </Button>
              <Button size="small" icon={<SyncOutlined />} onClick={() => refetch()}>
                重新判断
              </Button>
            </Space>
          </Space>
        }
      />

      <Card
        title="推荐流程"
        extra={
          <Button icon={<SyncOutlined />} onClick={() => refetch()}>
            刷新数据
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Row gutter={[16, 16]}>
          {pipelineSteps.map((step) => {
            const tone = getStepTone(step.status);
            return (
              <Col xs={24} md={12} xl={8} key={step.key}>
                <Card size="small" style={{ height: '100%' }}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Text type="secondary">步骤 {step.index}</Text>
                      <Tag color={tone.color}>{tone.label}</Tag>
                    </Space>
                    <Text strong>{step.title}</Text>
                    <Text type="secondary">{step.summary}</Text>
                    <Tag>{step.metric}</Tag>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="什么时候做">
                        <Text type="secondary">{step.whenToUse}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="什么时候跳过">
                        <Text type="secondary">{step.skipWhen}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="完成标准">
                        <Text type="secondary">{step.doneRule}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="常见问题">
                        <Text type="secondary">{step.commonIssues}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="解决建议">
                        <Text type="secondary">{step.solutionTip}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="小例子">
                        <Text type="secondary">{step.example}</Text>
                      </Descriptions.Item>
                    </Descriptions>
                    <Space wrap>
                      {step.actions}
                      <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(step.detailPath)}>
                        {step.detailLabel}
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      <Card
        title="高级维护与排错"
        style={{ marginBottom: 16 }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card size="small" title="数据来源补充" style={{ height: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">用于补充新数据入口或处理零散新增。</Text>
                <Space wrap>
                  <Button icon={<CloudDownloadOutlined />} onClick={() => setUsdaModal(true)}>
                    USDA 导入
                  </Button>
                  <Button icon={<BarcodeOutlined />} onClick={() => setBarcodeModal(true)}>
                    条形码查询
                  </Button>
                  <Button onClick={() => setCandidateModal(true)}>候选晋升</Button>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" title="结构化补全" style={{ height: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">用于修历史缺口，尤其是标签、评分、补全状态不完整时。</Text>
                <Space wrap>
                  <Button icon={<RobotOutlined />} onClick={() => setAiLabelModal(true)}>
                    AI 标注
                  </Button>
                  <Button onClick={() => setStageModal(true)}>分阶段补全</Button>
                  <Button onClick={() => setBackfillModal(true)}>回填评分</Button>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" title="质检与排错" style={{ height: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">用于定位异常数据、冲突和补全效果问题。</Text>
                <Space wrap>
                  <Button onClick={() => setConsistencyModal(true)}>一致性校验</Button>
                  <Button onClick={() => enrichmentStats.mutate()}>补全统计</Button>
                  <Button danger icon={<WarningOutlined />} onClick={() => resolveConflicts.mutate()}>
                    自动解决冲突
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* 总览统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="食物总数" value={totalFoods} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="已验证"
              value={quality?.verified || 0}
              suffix={`/ ${totalFoods}`}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="平均置信度"
              value={((quality?.avgConfidence || 0) * 100).toFixed(1)}
              suffix="%"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="待处理冲突"
              value={conflicts?.pending || 0}
              valueStyle={{ color: conflicts?.pending ? '#cf1322' : '#3f8600' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 数据完整度 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card title="数据完整度">
            {completeness && totalFoods ? (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {[
                  { label: '宏量营养素', value: completeness.withProtein },
                  { label: '微量营养素', value: completeness.withMicronutrients },
                  { label: '过敏原', value: completeness.withAllergens },
                  { label: '食物图片', value: completeness.withImage },
                  { label: '搭配关系', value: completeness.withCompatibility },
                ].map((item) => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Text style={{ width: 100 }}>{item.label}</Text>
                    <Progress
                      percent={Math.round((item.value / totalFoods) * 100)}
                      size="small"
                      style={{ flex: 1 }}
                    />
                    <Text type="secondary" style={{ width: 60, textAlign: 'right' }}>
                      {item.value}/{totalFoods}
                    </Text>
                  </div>
                ))}
              </Space>
            ) : (
              <Text type="secondary">暂无数据</Text>
            )}
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="数据分布">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="按状态">
                <Space wrap>
                  {report?.byStatus &&
                    Object.entries(report.byStatus).map(([status, count]) => (
                      <Tag key={status}>
                        {status}: {count as number}
                      </Tag>
                    ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="按来源">
                <Space wrap>
                  {report?.bySource &&
                    report.bySource.map(({ source, count }) => (
                      <Tag key={source} color="blue">
                        {source}: {count}
                      </Tag>
                    ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="冲突统计">
                <Space>
                  <Tag color="red">待处理: {conflicts?.pending || 0}</Tag>
                  <Tag color="green">已解决: {conflicts?.resolved || 0}</Tag>
                  <Tag>总计: {conflicts?.total || 0}</Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="翻译覆盖">
                <Space wrap>
                  {translations?.locales &&
                    translations.locales.map(({ locale, count }) => (
                      <Tag key={locale} color="purple">
                        {locale}: {count}
                      </Tag>
                    ))}
                  <Tag color="orange">未翻译: {translations?.foodsWithoutTranslation || 0}</Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="宏量一致性">
                <Tag
                  color={
                    quality &&
                    totalFoods &&
                    (totalFoods - (quality.macroInconsistent || 0)) / totalFoods > 0.8
                      ? 'green'
                      : 'orange'
                  }
                >
                  通过: {totalFoods - (quality?.macroInconsistent || 0)}/{totalFoods}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* USDA 导入弹窗 */}
      <Modal
        title="USDA 数据导入"
        open={usdaModal}
        onCancel={() => setUsdaModal(false)}
        onOk={() => usdaForm.validateFields().then((v) => importUsda.mutate(v))}
        confirmLoading={importUsda.isPending}
      >
        <Alert
          message="从 USDA FoodData Central 搜索并导入食物数据。需要配置 USDA_API_KEY 环境变量。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={usdaForm} layout="vertical" initialValues={{ maxItems: 50 }}>
          <Form.Item
            name="query"
            label="搜索关键词"
            rules={[{ required: true, message: '请输入搜索关键词' }]}
          >
            <Input placeholder="例如: chicken breast, rice, apple" />
          </Form.Item>
          <Form.Item name="maxItems" label="最大导入数量">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 条形码查询弹窗 */}
      <Modal
        title="条形码查询"
        open={barcodeModal}
        onCancel={() => setBarcodeModal(false)}
        onOk={() => {
          if (barcodeValue) lookupBarcode.mutate(barcodeValue);
        }}
        confirmLoading={lookupBarcode.isPending}
      >
        <Alert
          message="通过 Open Food Facts 数据库查询条形码并导入产品信息。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Input
          placeholder="请输入 EAN-13 条形码"
          value={barcodeValue}
          onChange={(e) => setBarcodeValue(e.target.value)}
          prefix={<BarcodeOutlined />}
        />
      </Modal>

      {/* AI 标注弹窗 */}
      <Modal
        title="AI 智能标注"
        open={aiLabelModal}
        onCancel={() => setAiLabelModal(false)}
        onOk={() => aiLabelForm.validateFields().then((v) => batchLabel.mutate(v))}
        confirmLoading={batchLabel.isPending}
      >
        <Alert
          message="使用 DeepSeek V3 AI 对食物进行分类、标签和评分标注。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={aiLabelForm} layout="vertical" initialValues={{ limit: 50, unlabeled: true }}>
          <Form.Item name="category" label="限定分类（可选）">
            <Select
              allowClear
              placeholder="全部分类"
              options={[
                { label: '蛋白质类', value: 'protein' },
                { label: '谷物主食', value: 'grain' },
                { label: '蔬菜', value: 'veggie' },
                { label: '水果', value: 'fruit' },
                { label: '乳制品', value: 'dairy' },
                { label: '油脂坚果', value: 'fat' },
                { label: '饮品', value: 'beverage' },
                { label: '零食甜点', value: 'snack' },
              ]}
            />
          </Form.Item>
          <Form.Item name="unlabeled" label="仅处理未标注" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI 翻译弹窗 */}
      <Modal
        title="AI 智能翻译"
        open={translateModal}
        onCancel={() => setTranslateModal(false)}
        onOk={() => translateForm.validateFields().then((v) => batchTranslate.mutate(v))}
        confirmLoading={batchTranslate.isPending}
      >
        <Alert
          message="使用 DeepSeek V3 AI 将食物名称翻译为目标语言。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={translateForm}
          layout="vertical"
          initialValues={{ limit: 50, targetLocales: ['en-US'], untranslatedOnly: true }}
        >
          <Form.Item
            name="targetLocales"
            label="目标语言"
            rules={[{ required: true, message: '请选择至少一个目标语言' }]}
          >
            <Select
              mode="multiple"
              options={[
                { label: '英语 (en-US)', value: 'en-US' },
                { label: '简体中文 (zh-CN)', value: 'zh-CN' },
                { label: '繁体中文 (zh-TW)', value: 'zh-TW' },
                { label: '日语 (ja-JP)', value: 'ja-JP' },
                { label: '韩语 (ko-KR)', value: 'ko-KR' },
              ]}
              maxTagCount={3}
            />
          </Form.Item>
          <Form.Item name="untranslatedOnly" label="仅翻译未翻译的">
            <Select
              options={[
                { label: '是', value: true },
                { label: '否', value: false },
              ]}
            />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="评分回填"
        open={backfillModal}
        onCancel={() => setBackfillModal(false)}
        onOk={() => backfillForm.validateFields().then((v) => backfillScores.mutate(v))}
        confirmLoading={backfillScores.isPending}
      >
        <Alert
          message="批量回填缺失评分"
          description="为没有 health assessment 评分数据的食物批量回填 nutrientDensity、qualityScore、satietyScore。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={backfillForm} layout="vertical" initialValues={{ batchSize: 200 }}>
          <Form.Item name="batchSize" label="批次大小">
            <InputNumber min={1} max={2000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="候选食物晋升"
        open={candidateModal}
        onCancel={() => setCandidateModal(false)}
        onOk={() => candidateForm.validateFields().then((v) => promoteCandidates.mutate(v))}
        confirmLoading={promoteCandidates.isPending}
      >
        <Alert
          message="将候选食物晋升为正式食物"
          description="按最小置信度和数量上限，从 food_candidates 中挑选候选数据晋升到 foods。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={candidateForm} layout="vertical" initialValues={{ minConfidence: 0.7, limit: 50 }}>
          <Form.Item name="minConfidence" label="最低置信度">
            <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="分阶段即时补全"
        open={stageModal}
        onCancel={() => setStageModal(false)}
        onOk={() => stageForm.validateFields().then((v) => batchEnrichStage.mutate(v))}
        confirmLoading={batchEnrichStage.isPending}
      >
        <Alert
          message="按阶段执行 AI 补全"
          description="适合小批量即时补全，会直接按选定阶段触发 enrichment。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={stageForm} layout="vertical" initialValues={{ stages: [1, 2], limit: 10 }}>
          <Form.Item name="stages" label="补全阶段">
            <Select
              mode="multiple"
              options={[
                { label: 'Stage 1 基础营养', value: 1 },
                { label: 'Stage 2 健康评估', value: 2 },
                { label: 'Stage 3 标签餐次', value: 3 },
                { label: 'Stage 4 份量信息', value: 4 },
                { label: 'Stage 5 扩展属性', value: 5 },
              ]}
            />
          </Form.Item>
          <Form.Item name="category" label="限定分类（可选)">
            <Select
              allowClear
              options={[
                { label: '蛋白质类', value: 'protein' },
                { label: '谷物主食', value: 'grain' },
                { label: '蔬菜', value: 'veggie' },
                { label: '水果', value: 'fruit' },
                { label: '乳制品', value: 'dairy' },
                { label: '油脂坚果', value: 'fat' },
                { label: '饮品', value: 'beverage' },
                { label: '零食甜点', value: 'snack' },
                { label: '复合菜肴', value: 'composite' },
              ]}
            />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="同类一致性校验"
        open={consistencyModal}
        onCancel={() => setConsistencyModal(false)}
        onOk={() =>
          consistencyForm
            .validateFields()
            .then((v) => consistencyCheck.mutate(v.foodId))
        }
        confirmLoading={consistencyCheck.isPending}
      >
        <Alert
          message="按食物 ID 执行 IQR 离群检测"
          description="用于检查某条食物记录是否显著偏离同类数据分布。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={consistencyForm} layout="vertical">
          <Form.Item
            name="foodId"
            label="选择食物"
            rules={[{ required: true, message: '请选择食物' }]}
          >
            <Select
              showSearch
              filterOption={false}
              placeholder="输入食物名称搜索"
              onSearch={handleConsistencySearch}
              notFoundContent={consistencySearching ? '搜索中...' : '暂无结果'}
              options={consistencyOptions}
            />
          </Form.Item>
        </Form>
        {consistencyCheck.data && (
          <>
            <Descriptions title="校验结果" column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="食物">
                {consistencyCheck.data.foodName} ({consistencyCheck.data.category})
              </Descriptions.Item>
              <Descriptions.Item label="同类样本数">
                {consistencyCheck.data.peerCount}
              </Descriptions.Item>
              <Descriptions.Item label="离群字段数">
                {consistencyCheck.data.outliers.length}
              </Descriptions.Item>
            </Descriptions>

            <Table
              size="small"
              pagination={false}
              rowKey={(row) => `${row.field}-${row.severity}`}
              dataSource={consistencyCheck.data.outliers}
              locale={{ emptyText: '未发现离群字段' }}
              columns={[
                { title: '字段', dataIndex: 'field', key: 'field' },
                { title: '当前值', dataIndex: 'value', key: 'value', width: 100 },
                {
                  title: '正常区间',
                  key: 'range',
                  render: (_, row) => `${row.lowerBound} ~ ${row.upperBound}`,
                  width: 180,
                },
                { title: 'Q1', dataIndex: 'q1', key: 'q1', width: 90 },
                { title: 'Q3', dataIndex: 'q3', key: 'q3', width: 90 },
                { title: 'IQR', dataIndex: 'iqr', key: 'iqr', width: 90 },
                {
                  title: '严重级别',
                  dataIndex: 'severity',
                  key: 'severity',
                  width: 120,
                  render: (severity: 'warning' | 'critical') => (
                    <Tag color={severity === 'critical' ? 'red' : 'orange'}>
                      {severity === 'critical' ? '严重' : '预警'}
                    </Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title="AI 补全统计"
        open={statsModal}
        onCancel={() => setStatsModal(false)}
        footer={null}
        width={960}
      >
        {enrichmentStats.data && (
          <>
            <Descriptions title="总体统计" column={3} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="总次数">{enrichmentStats.data.total}</Descriptions.Item>
              <Descriptions.Item label="直接入库">{enrichmentStats.data.directApplied}</Descriptions.Item>
              <Descriptions.Item label="暂存">{enrichmentStats.data.staged}</Descriptions.Item>
              <Descriptions.Item label="审核通过">{enrichmentStats.data.approved}</Descriptions.Item>
              <Descriptions.Item label="审核拒绝">{enrichmentStats.data.rejected}</Descriptions.Item>
              <Descriptions.Item label="通过率">{enrichmentStats.data.approvalRate}%</Descriptions.Item>
              <Descriptions.Item label="平均置信度">{enrichmentStats.data.avgConfidence}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              pagination={false}
              rowKey={(row) => `${row.stage}-${row.stageName}`}
              dataSource={enrichmentStats.data.stageStats}
              columns={[
                { title: '阶段', dataIndex: 'stage', key: 'stage', width: 80 },
                { title: '阶段名称', dataIndex: 'stageName', key: 'stageName' },
                { title: '字段数', dataIndex: 'totalFields', key: 'totalFields', width: 100 },
                { title: '平均成功率', dataIndex: 'avgSuccessRate', key: 'avgSuccessRate', width: 140, render: (v: number) => `${v}%` },
              ]}
              style={{ marginBottom: 16 }}
            />
            <Table
              size="small"
              pagination={{ pageSize: 10 }}
              rowKey={(row) => `${row.date}-${row.action}`}
              dataSource={enrichmentStats.data.dailyStats}
              columns={[
                { title: '日期', dataIndex: 'date', key: 'date', width: 140 },
                { title: '动作', dataIndex: 'action', key: 'action' },
                { title: '数量', dataIndex: 'count', key: 'count', width: 100 },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default PipelineDashboard;
