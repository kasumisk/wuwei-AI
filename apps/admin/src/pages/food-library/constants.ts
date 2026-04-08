// 食物分类
export const FOOD_CATEGORIES = [
  { label: '蛋白质类', value: 'protein' },
  { label: '谷物主食', value: 'grain' },
  { label: '蔬菜', value: 'veggie' },
  { label: '水果', value: 'fruit' },
  { label: '乳制品', value: 'dairy' },
  { label: '油脂坚果', value: 'fat' },
  { label: '饮品', value: 'beverage' },
  { label: '零食甜点', value: 'snack' },
  { label: '调味料', value: 'condiment' },
  { label: '复合菜肴', value: 'composite' },
] as const;

export const CATEGORY_MAP = Object.fromEntries(
  FOOD_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<string, string>;

// 食物状态
export const STATUS_MAP: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '已上线', color: 'success' },
  archived: { text: '已归档', color: 'warning' },
  merged: { text: '已合并', color: 'purple' },
};

// 数据来源
export const SOURCE_MAP: Record<string, string> = {
  manual: '手工录入',
  official: '官方数据',
  usda: 'USDA',
  openfoodfacts: 'Open Food Facts',
  ai: 'AI生成',
  crawl: '爬虫',
};

// 餐次
export const MEAL_TYPE_OPTIONS = [
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '加餐', value: 'snack' },
];

// 冲突解决方式
export const RESOLUTION_OPTIONS = [
  { label: '手动选择', value: 'manual' },
  { label: '采用高优先级来源', value: 'priority' },
  { label: '采用均值', value: 'average' },
  { label: '忽略此冲突', value: 'ignore' },
];

// 变更操作类型颜色
export const ACTION_COLORS: Record<string, string> = {
  create: 'green',
  update: 'blue',
  verify: 'cyan',
  archive: 'orange',
  merge: 'purple',
  delete: 'red',
};

// 语言选项
export const LOCALE_OPTIONS = [
  { label: '简体中文', value: 'zh-CN' },
  { label: '繁体中文', value: 'zh-TW' },
  { label: '英语', value: 'en-US' },
  { label: '日语', value: 'ja-JP' },
  { label: '韩语', value: 'ko-KR' },
];
