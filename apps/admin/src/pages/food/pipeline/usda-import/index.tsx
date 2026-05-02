import React, { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Space,
  Table,
  Input,
  InputNumber,
  message,
  Tag,
  Typography,
  Form,
  Modal,
  Alert,
  Descriptions,
  Row,
  Col,
  Select,
} from 'antd';
import {
  SearchOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import {
  foodPipelineApi,
  type FoodImportMode,
  type ImportPreviewResult,
  useImportUsda,
  useUsdaImportJob,
  useImportUsdaCategory,
  useImportUsdaPreset,
  useUsdaCategories,
  useUsdaPresets,
  type ImportResult,
  type UsdaImportJobStatus,
  type UsdaSearchResult,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'usda-import',
  title: 'USDA 导入',
  icon: 'CloudDownloadOutlined',
  order: 2,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;
const RECOMMENDED_IMPORT_MODE: FoodImportMode = 'fill_missing_only';
const USDA_IMPORT_STORAGE_KEY = 'food-pipeline.usda-import.last-used';
const USDA_IMPORT_RESULT_STORAGE_KEY = 'food-pipeline.usda-import.last-result';
const USDA_IMPORT_JOB_STORAGE_KEY = 'food-pipeline.usda-import.last-job';

type UsdaImportPageSettings = {
  searchQuery: string;
  keyword: {
    query: string;
    maxItems: number;
    importMode: FoodImportMode;
  };
  preset: {
    presetKey: string;
    maxItemsPerQuery: number;
    importMode: FoodImportMode;
  };
  category: {
    foodCategory: string;
    pageSize: number;
    maxPages: number;
    importMode: FoodImportMode;
  };
};

const DEFAULT_USDA_IMPORT_SETTINGS: UsdaImportPageSettings = {
  searchQuery: '',
  keyword: {
    query: '',
    maxItems: 50,
    importMode: RECOMMENDED_IMPORT_MODE,
  },
  preset: {
    presetKey: '',
    maxItemsPerQuery: 50,
    importMode: RECOMMENDED_IMPORT_MODE,
  },
  category: {
    foodCategory: '',
    pageSize: 50,
    maxPages: 3,
    importMode: RECOMMENDED_IMPORT_MODE,
  },
};

const IMPORT_MODE_OPTIONS: Array<{
  value: FoodImportMode;
  label: string;
  description: string;
}> = [
  {
    value: 'conservative',
    label: '保守模式（推荐）',
    description: '命中已有食物时只补缺失，并生成冲突记录，不主动覆盖主库已有核心字段。',
  },
  {
    value: 'fill_missing_only',
    label: '仅补缺失（中国主库推荐）',
    description: '命中已有食物时只补空字段，不创建冲突记录，适合中国食物成分表作为主库时补 USDA 附加信息。',
  },
  {
    value: 'create_only',
    label: '仅新增',
    description: '命中已有食物直接跳过，只导入主库里完全没有的新食物。',
  },
];

const MAPPED_CATEGORY_LABELS: Record<string, string> = {
  protein: '蛋白质类',
  veggie: '蔬菜类',
  fruit: '水果类',
  grain: '谷物类',
  dairy: '乳蛋类',
  beverage: '饮品类',
  snack: '零食类',
  condiment: '调味类',
  fat: '油脂类',
  composite: '复合食品',
};

const getImportModeLabel = (mode: FoodImportMode) =>
  IMPORT_MODE_OPTIONS.find((item) => item.value === mode)?.label || mode;

const getMappedCategoryLabel = (mappedCategory: string) =>
  MAPPED_CATEGORY_LABELS[mappedCategory] || mappedCategory;

const isImportMode = (value: unknown): value is FoodImportMode =>
  value === 'conservative' || value === 'fill_missing_only' || value === 'create_only';

const sanitizePositiveNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const loadUsdaImportSettings = (): UsdaImportPageSettings => {
  if (typeof window === 'undefined') return DEFAULT_USDA_IMPORT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(USDA_IMPORT_STORAGE_KEY);
    if (!raw) return DEFAULT_USDA_IMPORT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UsdaImportPageSettings>;
    return {
      searchQuery:
        typeof parsed.searchQuery === 'string'
          ? parsed.searchQuery
          : DEFAULT_USDA_IMPORT_SETTINGS.searchQuery,
      keyword: {
        query:
          typeof parsed.keyword?.query === 'string'
            ? parsed.keyword.query
            : DEFAULT_USDA_IMPORT_SETTINGS.keyword.query,
        maxItems: sanitizePositiveNumber(
          parsed.keyword?.maxItems,
          DEFAULT_USDA_IMPORT_SETTINGS.keyword.maxItems,
        ),
        importMode: isImportMode(parsed.keyword?.importMode)
          ? parsed.keyword.importMode
          : DEFAULT_USDA_IMPORT_SETTINGS.keyword.importMode,
      },
      preset: {
        presetKey:
          typeof parsed.preset?.presetKey === 'string'
            ? parsed.preset.presetKey
            : DEFAULT_USDA_IMPORT_SETTINGS.preset.presetKey,
        maxItemsPerQuery: sanitizePositiveNumber(
          parsed.preset?.maxItemsPerQuery,
          DEFAULT_USDA_IMPORT_SETTINGS.preset.maxItemsPerQuery,
        ),
        importMode: isImportMode(parsed.preset?.importMode)
          ? parsed.preset.importMode
          : DEFAULT_USDA_IMPORT_SETTINGS.preset.importMode,
      },
      category: {
        foodCategory:
          typeof parsed.category?.foodCategory === 'string'
            ? parsed.category.foodCategory
            : DEFAULT_USDA_IMPORT_SETTINGS.category.foodCategory,
        pageSize: sanitizePositiveNumber(
          parsed.category?.pageSize,
          DEFAULT_USDA_IMPORT_SETTINGS.category.pageSize,
        ),
        maxPages: sanitizePositiveNumber(
          parsed.category?.maxPages,
          DEFAULT_USDA_IMPORT_SETTINGS.category.maxPages,
        ),
        importMode: isImportMode(parsed.category?.importMode)
          ? parsed.category.importMode
          : DEFAULT_USDA_IMPORT_SETTINGS.category.importMode,
      },
    };
  } catch {
    return DEFAULT_USDA_IMPORT_SETTINGS;
  }
};

const persistUsdaImportSettings = (settings: UsdaImportPageSettings) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USDA_IMPORT_STORAGE_KEY, JSON.stringify(settings));
};

const loadLastImportResult = (): ImportResult | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(USDA_IMPORT_RESULT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImportResult;
  } catch {
    return null;
  }
};

const persistLastImportResult = (result: ImportResult | null) => {
  if (typeof window === 'undefined') return;
  if (!result) {
    window.localStorage.removeItem(USDA_IMPORT_RESULT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USDA_IMPORT_RESULT_STORAGE_KEY, JSON.stringify(result));
};

const loadLastImportJobId = (): string => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(USDA_IMPORT_JOB_STORAGE_KEY) || '';
};

const persistLastImportJobId = (jobId: string) => {
  if (typeof window === 'undefined') return;
  if (!jobId) {
    window.localStorage.removeItem(USDA_IMPORT_JOB_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USDA_IMPORT_JOB_STORAGE_KEY, jobId);
};

const groupImportDetails = (details: string[]) => {
  const groups = {
    system: [] as string[],
    matchedUpdated: [] as string[],
    matchedSkipped: [] as string[],
    conflicts: [] as string[],
    errors: [] as string[],
  };

  for (const item of details) {
    if (item.startsWith('Matched and updated:')) groups.matchedUpdated.push(item);
    else if (item.startsWith('Matched existing without field updates:'))
      groups.matchedSkipped.push(item);
    else if (item.startsWith('Conflicts created for')) groups.conflicts.push(item);
    else if (item.startsWith('Error:') || item.startsWith('Import error:')) groups.errors.push(item);
    else groups.system.push(item);
  }

  return groups;
};

const ensureDetailGroups = (result: ImportResult) =>
  result.detailGroups || groupImportDetails(result.details || []);

const buildPreviewRecommendation = (preview: ImportPreviewResult) => {
  if (preview.total === 0 || preview.cleaned === 0) {
    return {
      type: 'warning' as const,
      title: '当前不建议导入',
      description: '预估结果显示没有可处理数据，建议先换预设包、分类或关键词。',
      suggestedMode: null as FoodImportMode | null,
    };
  }

  if (preview.estimatedConflictCount >= 10) {
    return {
      type: 'error' as const,
      title: '建议先切到“仅补缺失”',
      description: `当前预估有 ${preview.estimatedConflictCount} 条潜在冲突，直接用保守模式导入会产生较多待处理项。若你的主库是中国食物成分表，优先改成“仅补缺失（中国主库推荐）”。`,
      suggestedMode: 'fill_missing_only' as FoodImportMode,
    };
  }

  if (preview.estimatedMatchedSkipped > preview.estimatedCreated * 3) {
    return {
      type: 'info' as const,
      title: '建议谨慎导入或缩小范围',
      description: '大部分数据会命中后跳过，说明这批 USDA 数据与你现有主库高度重叠。更适合缩小范围，或只补你缺的分类。',
      suggestedMode: null as FoodImportMode | null,
    };
  }

  if (preview.importMode === 'create_only' && preview.estimatedCreated === 0) {
    return {
      type: 'warning' as const,
      title: '仅新增模式收益很低',
      description: '当前模式下几乎不会新增新食物，建议改成“仅补缺失”获取 USDA 的补充字段价值。',
      suggestedMode: 'fill_missing_only' as FoodImportMode,
    };
  }

  if (preview.importMode === 'conservative' && preview.estimatedMatchedUpdated > preview.estimatedCreated) {
    return {
      type: 'success' as const,
      title: '这批更适合补中国主库',
      description: '命中更新数高于新增数，说明这批 USDA 数据主要用于补现有中国主库，当前导入方向是对的。',
      suggestedMode: 'fill_missing_only' as FoodImportMode,
    };
  }

  return {
    type: 'success' as const,
    title: '可以继续导入',
    description: '预估结果正常，可按当前模式继续导入；导入后再看命中更新、冲突和跳过情况是否符合预期。',
    suggestedMode: null as FoodImportMode | null,
  };
};

const buildPreviewSummaryText = (preview: ImportPreviewResult) => {
  const lines = [
    'USDA 导入前预估摘要',
    `模式: ${getImportModeLabel(preview.importMode)}`,
    `原始总数: ${preview.total}`,
    `清洗后: ${preview.cleaned}`,
    `清洗丢弃: ${preview.discarded}`,
    `预计新增: ${preview.estimatedCreated}`,
    `预计命中补缺更新: ${preview.estimatedMatchedUpdated}`,
    `预计命中跳过: ${preview.estimatedMatchedSkipped}`,
    `预计潜在冲突: ${preview.estimatedConflictCount}`,
  ];

  if (preview.samples.created.length > 0) {
    lines.push(
      `新增样本: ${preview.samples.created
        .slice(0, 5)
        .map((item) => `${item.name}[${item.sourceId}]`)
        .join('；')}`,
    );
  }
  if (preview.samples.matchedUpdated.length > 0) {
    lines.push(
      `命中补缺更新样本: ${preview.samples.matchedUpdated
        .slice(0, 5)
        .map((item) => `${item.name} -> ${item.existingName}`)
        .join('；')}`,
    );
  }
  if (preview.samples.conflicts.length > 0) {
    lines.push(
      `冲突样本: ${preview.samples.conflicts
        .slice(0, 5)
        .map((item) => `${item.name} -> ${item.existingName}`)
        .join('；')}`,
    );
  }

  return lines.join('\n');
};

const buildImportSummaryText = (
  result: ImportResult,
  detailGroups: ReturnType<typeof ensureDetailGroups>,
) => {
  const lines = [
    'USDA 导入结果摘要',
    `模式: ${getImportModeLabel(result.importMode)}`,
    `总处理数: ${result.total}`,
    `新增: ${result.created}`,
    `命中补缺更新: ${result.updated}`,
    `跳过: ${result.skipped}`,
    `错误: ${result.errors}`,
    `命中补缺更新: ${result.matchedUpdated}`,
    `命中跳过: ${result.matchedSkipped}`,
    `新增冲突: ${result.conflictCreated}`,
  ];

  if (detailGroups.system.length > 0) {
    lines.push(`系统说明: ${detailGroups.system.slice(0, 5).join('；')}`);
  }
  if (detailGroups.matchedUpdated.length > 0) {
    lines.push(`命中更新明细: ${detailGroups.matchedUpdated.slice(0, 5).join('；')}`);
  }
  if (detailGroups.conflicts.length > 0) {
    lines.push(`冲突明细: ${detailGroups.conflicts.slice(0, 5).join('；')}`);
  }
  if (detailGroups.errors.length > 0) {
    lines.push(`错误明细: ${detailGroups.errors.slice(0, 5).join('；')}`);
  }

  return lines.join('\n');
};

const buildImportJobSummaryText = (job: UsdaImportJobStatus) => {
  const lines = [
    'USDA 导入任务摘要',
    `任务 ID: ${job.id}`,
    `状态: ${job.status}`,
    `任务类型: ${job.data?.mode || '-'}`,
    `重试次数: ${job.attemptsMade}`,
  ];

  if (job.data?.query) lines.push(`关键词: ${job.data.query}`);
  if (job.data?.presetKey) lines.push(`预设包: ${job.data.presetKey}`);
  if (job.data?.foodCategory) lines.push(`分类: ${job.data.foodCategory}`);
  if (job.failedReason) lines.push(`失败原因: ${job.failedReason}`);

  return lines.join('\n');
};

const parseCategoryAudit = (systemMessages: string[]) => {
  let rawFetched = 0;
  let exactKept = 0;
  let filteredOut = 0;

  for (const message of systemMessages) {
    const pageMatch = message.match(
      /^Category page \d+: fetched (\d+)\/\d+, exact-category kept (\d+), filtered out (\d+)$/,
    );
    if (pageMatch) {
      rawFetched += Number(pageMatch[1]);
      exactKept += Number(pageMatch[2]);
      filteredOut += Number(pageMatch[3]);
      continue;
    }

    const totalFilteredMatch = message.match(/^Filtered out cross-category foods: (\d+)$/);
    if (totalFilteredMatch) {
      filteredOut = Number(totalFilteredMatch[1]);
    }
  }

  if (rawFetched === 0 && exactKept === 0 && filteredOut === 0) {
    return null;
  }

  return {
    rawFetched,
    exactKept,
    filteredOut,
  };
};

const UsdaImportPage: React.FC = () => {
  const [savedSettings] = useState(loadUsdaImportSettings);
  const [searchQuery, setSearchQuery] = useState(savedSettings.searchQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<UsdaSearchResult | null>(null);
  const [importModal, setImportModal] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(loadLastImportResult);
  const [activeImportJobId, setActiveImportJobId] = useState(loadLastImportJobId);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [presetModal, setPresetModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(savedSettings.category.foodCategory);
  const [recentPresetResults, setRecentPresetResults] = useState<Record<string, ImportResult>>({});
  const [presetPreviewMap, setPresetPreviewMap] = useState<Record<string, ImportPreviewResult>>({});
  const [previewingPresetKey, setPreviewingPresetKey] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSource, setPreviewSource] = useState<'keyword' | 'preset' | 'category' | null>(null);
  const [lastNotifiedJobId, setLastNotifiedJobId] = useState('');
  const [form] = Form.useForm();
  const [presetForm] = Form.useForm();
  const [categoryForm] = Form.useForm();
  const keywordQueryValue = Form.useWatch('query', form);
  const keywordMaxItemsValue = Form.useWatch('maxItems', form);
  const keywordImportModeValue = Form.useWatch('importMode', form);
  const presetKeyValue = Form.useWatch('presetKey', presetForm);
  const presetMaxItemsValue = Form.useWatch('maxItemsPerQuery', presetForm);
  const presetImportModeValue = Form.useWatch('importMode', presetForm);
  const categoryFoodCategoryValue = Form.useWatch('foodCategory', categoryForm);
  const categoryPageSizeValue = Form.useWatch('pageSize', categoryForm);
  const categoryMaxPagesValue = Form.useWatch('maxPages', categoryForm);
  const categoryImportModeValue = Form.useWatch('importMode', categoryForm);
  const { data: presets, isLoading: presetsLoading } = useUsdaPresets();
  const { data: categories, isLoading: categoriesLoading } = useUsdaCategories();
  const { data: importJob, error: importJobError } = useUsdaImportJob(activeImportJobId || undefined);

  useEffect(() => {
    persistUsdaImportSettings({
      searchQuery,
      keyword: {
        query:
          typeof keywordQueryValue === 'string'
            ? keywordQueryValue
            : savedSettings.keyword.query,
        maxItems: sanitizePositiveNumber(keywordMaxItemsValue, savedSettings.keyword.maxItems),
        importMode: isImportMode(keywordImportModeValue)
          ? keywordImportModeValue
          : savedSettings.keyword.importMode,
      },
      preset: {
        presetKey:
          typeof presetKeyValue === 'string' ? presetKeyValue : savedSettings.preset.presetKey,
        maxItemsPerQuery: sanitizePositiveNumber(
          presetMaxItemsValue,
          savedSettings.preset.maxItemsPerQuery,
        ),
        importMode: isImportMode(presetImportModeValue)
          ? presetImportModeValue
          : savedSettings.preset.importMode,
      },
      category: {
        foodCategory:
          typeof categoryFoodCategoryValue === 'string'
            ? categoryFoodCategoryValue
            : selectedCategory,
        pageSize: sanitizePositiveNumber(categoryPageSizeValue, savedSettings.category.pageSize),
        maxPages: sanitizePositiveNumber(categoryMaxPagesValue, savedSettings.category.maxPages),
        importMode: isImportMode(categoryImportModeValue)
          ? categoryImportModeValue
          : savedSettings.category.importMode,
      },
    });
  }, [
    searchQuery,
    keywordQueryValue,
    keywordMaxItemsValue,
    keywordImportModeValue,
    presetKeyValue,
    presetMaxItemsValue,
    presetImportModeValue,
    categoryFoodCategoryValue,
    categoryPageSizeValue,
    categoryMaxPagesValue,
    categoryImportModeValue,
    selectedCategory,
    savedSettings,
  ]);

  useEffect(() => {
    persistLastImportResult(importResult);
  }, [importResult]);

  useEffect(() => {
    persistLastImportJobId(activeImportJobId);
  }, [activeImportJobId]);

  useEffect(() => {
    if (!importJob) return;
    if (importJob.status === 'completed' && importJob.result) {
      setImportResult(importJob.result);
      if (importJob.data?.mode === 'preset' && importJob.data?.presetKey) {
        setRecentPresetResults((prev) => ({
          ...prev,
          [importJob.data.presetKey]: importJob.result!,
        }));
      }
      if (lastNotifiedJobId !== String(importJob.id)) {
        message.success('USDA 导入任务已完成');
        setLastNotifiedJobId(String(importJob.id));
      }
    }
    if (importJob.status === 'failed' && lastNotifiedJobId !== String(importJob.id)) {
      message.error('USDA 导入任务失败，请查看任务详情');
      setLastNotifiedJobId(String(importJob.id));
    }
  }, [importJob, lastNotifiedJobId]);

  useEffect(() => {
    if (!activeImportJobId || !importJobError) return;

    const status = (importJobError as any)?.response?.status;
    if (status === 404) {
      setActiveImportJobId('');
      message.warning('未找到上次 USDA 导入任务，已清空当前任务记录');
    }
  }, [activeImportJobId, importJobError]);

  const importUsda = useImportUsda({
    onSuccess: (result) => {
      setActiveImportJobId(String(result.jobId));
      message.success('导入任务已提交，正在后台处理');
      setImportModal(false);
    },
    onError: (e: any) =>
      message.error(
        e?.code === 'ECONNABORTED'
          ? '导入等待超时，请缩小批量后重试，或稍后查看是否已部分完成。'
          : `导入失败: ${e.message}`,
      ),
  });

  const importUsdaPreset = useImportUsdaPreset({
    onSuccess: (result) => {
      setActiveImportJobId(String(result.jobId));
      message.success('预设导入任务已提交，正在后台处理');
      setPresetModal(false);
    },
    onError: (e: any) =>
      message.error(
        e?.code === 'ECONNABORTED'
          ? '预设导入等待超时，请先把每组查询词导入上限调小到 5-10 再重试。'
          : `预设导入失败: ${e.message}`,
      ),
  });

  const importUsdaCategory = useImportUsdaCategory({
    onSuccess: (result) => {
      setActiveImportJobId(String(result.jobId));
      message.success('分类导入任务已提交，正在后台处理');
      setCategoryModal(false);
    },
    onError: (e: any) =>
      message.error(
        e?.code === 'ECONNABORTED'
          ? '分类导入等待超时，请先降低每页导入数或最多导入页数。'
          : `分类导入失败: ${e.message}`,
      ),
  });

  const copySummary = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(`${label}复制失败，请检查浏览器权限`);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }
    setSearchLoading(true);
    try {
      const result = await foodPipelineApi.searchUsda(searchQuery, 50);
      setSearchResult(result);
    } catch (e: any) {
      message.error(`搜索失败: ${e.message}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleImport = () => {
    if (!searchQuery.trim()) {
      message.warning('请先搜索');
      return;
    }
    form.setFieldsValue({
      query: searchQuery,
      maxItems: sanitizePositiveNumber(keywordMaxItemsValue, savedSettings.keyword.maxItems),
      importMode: isImportMode(keywordImportModeValue)
        ? keywordImportModeValue
        : savedSettings.keyword.importMode,
    });
    setImportModal(true);
  };

  const continueImportFromPreview = () => {
    if (previewSource === 'keyword') {
      form.validateFields().then((values) => importUsda.mutate(values));
      return;
    }

    if (previewSource === 'preset') {
      presetForm.validateFields().then((values) => importUsdaPreset.mutate(values));
      return;
    }

    if (previewSource === 'category') {
      categoryForm.validateFields().then((values) => importUsdaCategory.mutate(values));
    }
  };

  const handleKeywordPreview = async () => {
    const values = await form.validateFields();
    setPreviewLoading(true);
    try {
      const result = await foodPipelineApi.previewUsda(values);
      setPreviewResult(result);
      setPreviewSource('keyword');
      setImportModal(false);
    } catch (e: any) {
      message.error(`预估失败: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePresetPreview = async () => {
    const values = await presetForm.validateFields();
    setPreviewLoading(true);
    try {
      const result = await foodPipelineApi.previewUsdaPreset(values);
      setPreviewResult(result);
      setPreviewSource('preset');
      setPresetModal(false);
    } catch (e: any) {
      message.error(`预估失败: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCategoryPreview = async () => {
    const values = await categoryForm.validateFields();
    setPreviewLoading(true);
    try {
      const result = await foodPipelineApi.previewUsdaCategory(values);
      setPreviewResult(result);
      setPreviewSource('category');
      setCategoryModal(false);
    } catch (e: any) {
      message.error(`预估失败: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const detailGroups = importResult ? ensureDetailGroups(importResult) : null;
  const previewRecommendation = previewResult
    ? buildPreviewRecommendation(previewResult)
    : null;
  const importSummaryText =
    importResult && detailGroups ? buildImportSummaryText(importResult, detailGroups) : '';
  const previewSummaryText = previewResult ? buildPreviewSummaryText(previewResult) : '';
  const importJobSummaryText = importJob ? buildImportJobSummaryText(importJob) : '';
  const previewCategoryAudit = previewResult ? parseCategoryAudit(previewResult.detailGroups.system) : null;
  const importCategoryAudit = detailGroups ? parseCategoryAudit(detailGroups.system) : null;
  const importJobStatusLabelMap: Record<UsdaImportJobStatus['status'], string> = {
    waiting: '排队中',
    active: '执行中',
    completed: '已完成',
    failed: '失败',
    delayed: '延迟中',
    'waiting-children': '等待子任务',
    unknown: '未知',
  };

  const applySuggestedMode = (mode: FoodImportMode) => {
    if (previewSource === 'keyword') {
      form.setFieldsValue({ importMode: mode });
      setImportModal(true);
      return;
    }
    if (previewSource === 'preset') {
      presetForm.setFieldsValue({ importMode: mode });
      setPresetModal(true);
      return;
    }
    if (previewSource === 'category') {
      categoryForm.setFieldsValue({ importMode: mode });
      setCategoryModal(true);
    }
  };

  const columns = [
    {
      title: 'USDA ID',
      dataIndex: 'fdcId',
      width: 100,
      render: (v: number) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '名称',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '分类',
      dataIndex: 'foodCategory',
      width: 150,
      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: '数据类型',
      dataIndex: 'dataType',
      width: 120,
      render: (v: string) => <Tag color="cyan">{v || '-'}</Tag>,
    },
    {
      title: '品牌',
      dataIndex: 'brandOwner',
      width: 150,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
  ];

  const estimatedPresetFetchCount = sanitizePositiveNumber(
    presetMaxItemsValue,
    savedSettings.preset.maxItemsPerQuery,
  ) * ((presets || []).find((item) => item.key === presetKeyValue)?.queryCount || 0);
  const estimatedCategoryFetchCount =
    sanitizePositiveNumber(categoryPageSizeValue, savedSettings.category.pageSize) *
    sanitizePositiveNumber(categoryMaxPagesValue, savedSettings.category.maxPages);

  const buildPresetCoverageHint = (preview?: ImportPreviewResult) => {
    if (!preview) return null;

    if (preview.total === 0 || preview.cleaned === 0) {
      return {
        color: 'default' as const,
        text: '当前没有有效数据',
      };
    }

    if (preview.estimatedCreated === 0 && preview.estimatedMatchedUpdated === 0) {
      return {
        color: 'default' as const,
        text: '这个包基本导过了，继续跑主要会跳过',
      };
    }

    if (preview.estimatedMatchedSkipped > (preview.estimatedCreated + preview.estimatedMatchedUpdated) * 2) {
      return {
        color: 'orange' as const,
        text: '重叠偏高，适合按需补缺，不适合反复整包重跑',
      };
    }

    if (preview.estimatedCreated + preview.estimatedMatchedUpdated >= Math.max(10, Math.floor(preview.cleaned * 0.4))) {
      return {
        color: 'green' as const,
        text: '这个包仍值得继续导入',
      };
    }

    return {
      color: 'blue' as const,
      text: '增量有限，建议先看预估再决定是否整包导入',
    };
  };

  const handleQuickPresetPreview = async (presetKey: string) => {
    setPreviewingPresetKey(presetKey);
    try {
      const result = await foodPipelineApi.previewUsdaPreset({
        presetKey,
        maxItemsPerQuery: sanitizePositiveNumber(
          presetMaxItemsValue,
          savedSettings.preset.maxItemsPerQuery,
        ),
        importMode: isImportMode(presetImportModeValue)
          ? presetImportModeValue
          : savedSettings.preset.importMode,
      });
      setPresetPreviewMap((prev) => ({
        ...prev,
        [presetKey]: result,
      }));
      message.success('已更新这个预设包的导入预估');
    } catch (e: any) {
      message.error(`预设预估失败: ${e.message}`);
    } finally {
      setPreviewingPresetKey('');
    }
  };

  return (
    <div>
      <Card
        title={
          <Space>
            <CloudDownloadOutlined /> USDA FoodData Central 数据导入
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="推荐方式：优先使用预设导入包"
          description="关键词搜索容易漏掉同义词和细分类。日常补库建议直接使用预设包导入。若你当前主库是中国食物成分表，导入策略默认推荐“仅补缺失（中国主库推荐）”。USDA 导入请求已放宽等待时间，但首轮仍建议从小批量开始，先看命中更新、跳过和冲突结构。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Row gutter={[16, 16]}>
          {(presets || []).map((preset) => (
            <Col xs={24} md={12} xl={8} key={preset.key}>
              <Card size="small" title={preset.label} style={{ height: '100%' }} loading={presetsLoading}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text type="secondary">{preset.description}</Text>
                  <Tag>{preset.queryCount} 组查询词</Tag>
                  <Text type="secondary">预计覆盖：{preset.coverage.join('、')}</Text>
                  {presetPreviewMap[preset.key] && (
                    (() => {
                      const preview = presetPreviewMap[preset.key];
                      const hint = buildPresetCoverageHint(preview);
                      return (
                        <>
                          <Descriptions column={3} size="small" bordered>
                            <Descriptions.Item label="预计新增">
                              <Tag color="green">{preview.estimatedCreated}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="预计命中补缺更新">
                              <Tag color="blue">{preview.estimatedMatchedUpdated}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="预计跳过">
                              <Tag>{preview.estimatedMatchedSkipped}</Tag>
                            </Descriptions.Item>
                          </Descriptions>
                          {hint && <Tag color={hint.color}>{hint.text}</Tag>}
                        </>
                      );
                    })()
                  )}
                  {recentPresetResults[preset.key] && (
                    <Descriptions column={3} size="small" bordered>
                      <Descriptions.Item label="新增">
                        <Tag color="green">{recentPresetResults[preset.key].created}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="更新">
                        <Tag color="blue">{recentPresetResults[preset.key].updated}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="跳过">
                        <Tag>{recentPresetResults[preset.key].skipped}</Tag>
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                  <Space wrap>
                    <Button
                      onClick={() => handleQuickPresetPreview(preset.key)}
                      loading={previewingPresetKey === preset.key}
                    >
                      快速预估
                    </Button>
                    <Button
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      onClick={() => {
                          presetForm.setFieldsValue({
                            presetKey: preset.key,
                            maxItemsPerQuery: sanitizePositiveNumber(
                              presetMaxItemsValue,
                              savedSettings.preset.maxItemsPerQuery,
                            ),
                            importMode: isImportMode(presetImportModeValue)
                              ? presetImportModeValue
                              : savedSettings.preset.importMode,
                          });
                        setPresetModal(true);
                      }}
                    >
                      导入这个预设包
                    </Button>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="第二入口：按 USDA 分类导入" style={{ marginBottom: 16 }}>
        <Alert
          message="适合系统性补一个大类"
          description="如果你已经有中国食物库，想再补一整类 USDA 数据，比如水果或乳制品，可直接按 USDA 分类分页导入。"
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space>
          <Select
            placeholder="选择 USDA 分类"
            style={{ width: 420 }}
            loading={categoriesLoading}
            value={selectedCategory || undefined}
            options={(categories || []).map((item) => ({
              value: item.value,
              label: `${item.label} (${item.value}) -> ${getMappedCategoryLabel(item.mappedCategory)}`,
            }))}
            onChange={(value) => {
              setSelectedCategory(value);
              categoryForm.setFieldsValue({
                foodCategory: value,
                pageSize: sanitizePositiveNumber(categoryPageSizeValue, savedSettings.category.pageSize),
                maxPages: sanitizePositiveNumber(categoryMaxPagesValue, savedSettings.category.maxPages),
                importMode: isImportMode(categoryImportModeValue)
                  ? categoryImportModeValue
                  : savedSettings.category.importMode,
              });
            }}
          />
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            onClick={() => setCategoryModal(true)}
            disabled={!selectedCategory}
            loading={importUsdaCategory.isPending}
          >
            分类导入
          </Button>
        </Space>
      </Card>

      <Card title="高级模式：关键词搜索预览" style={{ marginBottom: 16 }}>
        <Alert
          message="适合补单个食物，不适合建库"
          description="只有在你明确知道要查某个食物时，才建议使用关键词预览。大规模导入请优先用上面的预设包；如果只是给中国主库补字段，也推荐用“仅补缺失（中国主库推荐）”。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space>
          <Input
            placeholder="输入英文食物名称搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 400 }}
            prefix={<SearchOutlined />}
          />
          <Button
            type="primary"
            onClick={handleSearch}
            loading={searchLoading}
            icon={<SearchOutlined />}
          >
            搜索预览
          </Button>
          <Button
            onClick={handleImport}
            icon={<DatabaseOutlined />}
            disabled={!searchQuery.trim()}
            loading={importUsda.isPending}
          >
            关键词导入
          </Button>
        </Space>
      </Card>

      {/* 搜索结果 */}
      {searchResult && (
        <Card
          title={`搜索结果（共 ${searchResult.totalHits} 条，显示前 ${searchResult.foods.length} 条）`}
        >
          <Table
            dataSource={searchResult.foods}
            columns={columns}
            rowKey="fdcId"
            pagination={false}
            scroll={{ y: 500 }}
            size="small"
          />
        </Card>
      )}

      {/* 导入结果 */}
      {importJob && (
        <Card
          title="当前导入任务"
          style={{ marginTop: 16 }}
          extra={
            <Space>
              <Button icon={<CopyOutlined />} onClick={() => copySummary(importJobSummaryText, '任务摘要')}>
                复制任务摘要
              </Button>
              <Button
                onClick={() => {
                  setActiveImportJobId('');
                  setLastNotifiedJobId('');
                }}
              >
                清空任务
              </Button>
            </Space>
          }
        >
          <Descriptions column={3}>
            <Descriptions.Item label="任务 ID">
              <Text copyable>{String(importJob.id)}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag
                color={
                  importJob.status === 'completed'
                    ? 'green'
                    : importJob.status === 'failed'
                      ? 'red'
                      : 'blue'
                }
              >
                {importJobStatusLabelMap[importJob.status] || importJob.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="重试次数">{importJob.attemptsMade}</Descriptions.Item>
          </Descriptions>
          {importJob.status !== 'completed' && importJob.status !== 'failed' && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="后台处理中"
              description="当前 USDA 导入已转为异步任务，页面会自动轮询状态。你可以先离开页面，稍后回来查看结果。"
            />
          )}
          {importJob.status === 'completed' && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 12 }}
              message="任务已完成"
              description="最近导入结果已更新到下方卡片，你可以直接复制摘要或继续下一批导入。"
            />
          )}
          {importJob.status === 'failed' && importJob.failedReason && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              message="任务失败"
              description={importJob.failedReason}
            />
          )}
        </Card>
      )}

      {importResult && (
        <Card
          title="最近导入结果"
          style={{ marginTop: 16 }}
          extra={
            <Button icon={<CopyOutlined />} onClick={() => copySummary(importSummaryText, '导入摘要')}>
              复制摘要
            </Button>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="结果摘要"
            description={`本次使用 ${getImportModeLabel(importResult.importMode)}。共处理 ${importResult.total} 条 USDA 数据；新增 ${importResult.created} 条，命中后补缺更新 ${importResult.matchedUpdated} 条，命中后跳过 ${importResult.matchedSkipped} 条，新增冲突 ${importResult.conflictCreated} 条。`}
          />
          {importCategoryAudit && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="分类抓取审计"
              description={`过滤规则：只有 USDA 原始 foodCategory 与当前所选分类完全相等的数据才保留，其余即使被 USDA 分类查询接口返回，也会视为跨分类脏数据并过滤。USDA 原始返回 ${importCategoryAudit.rawFetched} 条；精确属于当前分类并保留 ${importCategoryAudit.exactKept} 条；过滤掉跨分类脏数据 ${importCategoryAudit.filteredOut} 条；最终进入本次导入处理的唯一项 ${importResult.total} 条。`}
            />
          )}
          <Descriptions column={3}>
            <Descriptions.Item label="导入模式">
              <Tag color="purple">{getImportModeLabel(importResult.importMode)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="总数">{importResult.total}</Descriptions.Item>
            <Descriptions.Item label="新增">
              <Tag color="green">{importResult.created}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="命中补缺更新">
              <Tag color="blue">{importResult.updated}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="跳过">
              <Tag>{importResult.skipped}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误">
              <Tag color="red">{importResult.errors}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="命中补缺更新">
              <Tag color="blue">{importResult.matchedUpdated}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="命中跳过">
              <Tag>{importResult.matchedSkipped}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="新增冲突">
              <Tag color="orange">{importResult.conflictCreated}</Tag>
            </Descriptions.Item>
          </Descriptions>
          {detailGroups && (
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
              {[
                { title: '系统说明', items: detailGroups.system },
                { title: '命中并更新', items: detailGroups.matchedUpdated },
                { title: '命中但跳过', items: detailGroups.matchedSkipped },
                { title: '新增冲突', items: detailGroups.conflicts },
                { title: '错误', items: detailGroups.errors },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <Col xs={24} md={12} key={group.title}>
                    <Card size="small" title={group.title}>
                      <div style={{ maxHeight: 180, overflow: 'auto' }}>
                        {group.items.map((item, index) => (
                          <div key={`${group.title}-${index}`} style={{ marginBottom: 8 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {item}
                            </Text>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </Col>
                ))}
            </Row>
          )}
        </Card>
      )}

      {previewResult && (
        <Card
          title="导入前预估"
          style={{ marginTop: 16 }}
          extra={
            <Button icon={<CopyOutlined />} onClick={() => copySummary(previewSummaryText, '预估摘要')}>
              复制摘要
            </Button>
          }
        >
          {previewRecommendation && (
            <Alert
              type={previewRecommendation.type}
              showIcon
              style={{ marginBottom: 16 }}
              message={previewRecommendation.title}
              description={
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text>{previewRecommendation.description}</Text>
                  <Space wrap>
                    {previewRecommendation.suggestedMode && (
                      <Button
                        type="primary"
                        size="small"
                        onClick={() => applySuggestedMode(previewRecommendation.suggestedMode!)}
                      >
                        一键切换到 {getImportModeLabel(previewRecommendation.suggestedMode)}
                      </Button>
                    )}
                    <Button size="small" onClick={continueImportFromPreview}>
                      按当前参数继续导入
                    </Button>
                  </Space>
                </Space>
              }
            />
          )}
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`预估模式：${getImportModeLabel(previewResult.importMode)}`}
            description={`预计新增 ${previewResult.estimatedCreated} 条，命中补缺更新 ${previewResult.estimatedMatchedUpdated} 条，命中跳过 ${previewResult.estimatedMatchedSkipped} 条，潜在冲突 ${previewResult.estimatedConflictCount} 条。`}
          />
          {previewCategoryAudit && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="分类抓取审计"
              description={`过滤规则：只有 USDA 原始 foodCategory 与当前所选分类完全相等的数据才保留，其余即使被 USDA 分类查询接口返回，也会视为跨分类脏数据并过滤。USDA 原始返回 ${previewCategoryAudit.rawFetched} 条；精确属于当前分类并保留 ${previewCategoryAudit.exactKept} 条；过滤掉跨分类脏数据 ${previewCategoryAudit.filteredOut} 条；最终进入本次预估处理的唯一项 ${previewResult.total} 条。`}
            />
          )}
          <Descriptions column={4} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="原始总数">{previewResult.total}</Descriptions.Item>
            <Descriptions.Item label="清洗后">{previewResult.cleaned}</Descriptions.Item>
            <Descriptions.Item label="清洗丢弃">{previewResult.discarded}</Descriptions.Item>
            <Descriptions.Item label="潜在冲突">
              <Tag color="orange">{previewResult.estimatedConflictCount}</Tag>
            </Descriptions.Item>
          </Descriptions>
          <Row gutter={[16, 16]}>
            {previewResult.samples.created.length > 0 && (
              <Col xs={24} md={12}>
                <Card size="small" title="预计新增样本">
                  {previewResult.samples.created.map((item, index) => (
                    <div key={`${item.sourceId}-${index}`} style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.name} [{item.sourceId}]
                      </Text>
                    </div>
                  ))}
                </Card>
              </Col>
            )}
            {previewResult.samples.matchedUpdated.length > 0 && (
              <Col xs={24} md={12}>
                <Card size="small" title="预计命中补缺更新样本">
                  {previewResult.samples.matchedUpdated.map((item, index) => (
                    <div key={`${item.name}-${index}`} style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.name} {'->'} {item.existingName} fields=[{item.fields.join(', ')}]
                      </Text>
                    </div>
                  ))}
                </Card>
              </Col>
            )}
            {previewResult.samples.conflicts.length > 0 && (
              <Col xs={24} md={12}>
                <Card size="small" title="预计冲突样本">
                  {previewResult.samples.conflicts.map((item, index) => (
                    <div key={`${item.name}-conflict-${index}`} style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.name} {'->'} {item.existingName} conflict=[{item.fields.join(', ')}]
                      </Text>
                    </div>
                  ))}
                </Card>
              </Col>
            )}
            {[
              { title: '系统说明', items: previewResult.detailGroups.system },
              { title: '预计命中补缺更新', items: previewResult.detailGroups.matchedUpdated },
              { title: '预计命中跳过', items: previewResult.detailGroups.matchedSkipped },
              { title: '预计冲突', items: previewResult.detailGroups.conflicts },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <Col xs={24} md={12} key={group.title}>
                  <Card size="small" title={group.title}>
                    <div style={{ maxHeight: 180, overflow: 'auto' }}>
                      {group.items.map((item, index) => (
                        <div key={`${group.title}-${index}`} style={{ marginBottom: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {item}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              ))}
          </Row>
        </Card>
      )}

      {/* 导入弹窗 */}
      <Modal
        title="批量导入 USDA 数据"
        open={importModal}
        onCancel={() => setImportModal(false)}
        onOk={() => form.validateFields().then((v) => importUsda.mutate(v))}
        confirmLoading={importUsda.isPending}
        okText="开始导入"
        cancelText="取消"
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button onClick={handleKeywordPreview} loading={previewLoading}>
              先做预估
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Form form={form} layout="vertical" initialValues={savedSettings.keyword}>
          <Form.Item name="query" label="搜索关键词" rules={[{ required: true }]}> 
            <Input />
          </Form.Item>
          <Form.Item name="maxItems" label="最大导入数量" extra="建议首次不超过 200 条">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="importMode" label="导入策略">
            <Select
              options={IMPORT_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="模式说明"
            description={`这里的数量是本次关键词导入的总上限。${IMPORT_MODE_OPTIONS.map((item) => `${item.label}：${item.description}`).join(' ')}`}
          />
        </Form>
      </Modal>

      <Modal
        title="导入 USDA 预设包"
        open={presetModal}
        onCancel={() => setPresetModal(false)}
        onOk={() => presetForm.validateFields().then((v) => importUsdaPreset.mutate(v))}
        confirmLoading={importUsdaPreset.isPending}
        okText="开始导入"
        cancelText="取消"
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button onClick={handlePresetPreview} loading={previewLoading}>
              先做预估
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Form
          form={presetForm}
          layout="vertical"
          initialValues={savedSettings.preset}
        >
          <Form.Item name="presetKey" label="预设包" rules={[{ required: true }]}> 
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="maxItemsPerQuery"
            label="每组查询词导入上限"
            extra="这是每组查询词各自的上限，不是整个预设包总数。系统会按每组抓取后再聚合去重。"
          >
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="importMode" label="导入策略">
            <Select
              options={IMPORT_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="模式说明"
            description={`当前预设大约会请求最多 ${estimatedPresetFetchCount} 条原始 USDA 结果（去重前，实际入库会更少）。${IMPORT_MODE_OPTIONS.map((item) => `${item.label}：${item.description}`).join(' ')}`}
          />
        </Form>
      </Modal>

      <Modal
        title="按 USDA 分类导入"
        open={categoryModal}
        onCancel={() => setCategoryModal(false)}
        onOk={() => categoryForm.validateFields().then((v) => importUsdaCategory.mutate(v))}
        confirmLoading={importUsdaCategory.isPending}
        okText="开始导入"
        cancelText="取消"
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button onClick={handleCategoryPreview} loading={previewLoading}>
              先做预估
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Form
          form={categoryForm}
          layout="vertical"
          initialValues={savedSettings.category}
        >
          <Form.Item name="foodCategory" label="USDA 分类" rules={[{ required: true }]}> 
            <Select
              options={(categories || []).map((item) => ({
                value: item.value,
                label: `${item.label} (${item.value}) -> ${getMappedCategoryLabel(item.mappedCategory)}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="pageSize" label="每页导入数" extra="这是单页抓取上限。总抓取量约等于 每页导入数 x 最多导入页数。">
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxPages" label="最多导入页数">
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="importMode" label="导入策略">
            <Select
              options={IMPORT_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="模式说明"
            description={`当前分类导入大约会请求最多 ${estimatedCategoryFetchCount} 条原始 USDA 结果（实际可能因最后一页不足或提前结束而更少）。${IMPORT_MODE_OPTIONS.map((item) => `${item.label}：${item.description}`).join(' ')}`}
          />
        </Form>
      </Modal>
    </div>
  );
};

export default UsdaImportPage;
