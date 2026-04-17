/**
 * 烹饪方式枚举常量
 *
 * 权威来源——所有需要引用烹饪方式短码的地方（AI 补全 prompt、
 * 评分、嵌入、过滤、菜名生成等）都应从此处导入，避免硬编码。
 *
 * 数据库 cooking_methods 列存储的就是这些英文短码。
 * 命名规则：动词原形 + 下划线分隔（stir_fry, deep_fry, ...）。
 */

// ─── 枚举值 ───

export const CookingMethod = {
  // 炒类
  STIR_FRY: 'stir_fry',
  DEEP_FRY: 'deep_fry',
  SHALLOW_FRY: 'shallow_fry',
  PAN_FRY: 'pan_fry',

  // 水热类
  STEAM: 'steam',
  BOIL: 'boil',
  SIMMER: 'simmer',
  STEW: 'stew',
  BRAISE: 'braise',
  PRESSURE_COOK: 'pressure_cook',

  // 干热类
  ROAST: 'roast',
  BAKE: 'bake',
  GRILL: 'grill',
  BARBECUE: 'barbecue',

  // 保鲜/腌制类
  SMOKE: 'smoke',
  PICKLE: 'pickle',
  FERMENT: 'ferment',

  // 其他
  RAW: 'raw',

  // 设备相关
  AIR_FRY: 'air_fry',
  MICROWAVE: 'microwave',
  RICE_COOK: 'rice_cook',
} as const;

export type CookingMethodValue =
  (typeof CookingMethod)[keyof typeof CookingMethod];

/** 所有合法的烹饪方式短码集合，可用于验证 */
export const ALL_COOKING_METHODS: readonly CookingMethodValue[] =
  Object.values(CookingMethod);

// ─── 分组常量（用于菜名生成模板匹配） ───

/** 翻炒类：菜名模板 "蔬菜 + 方法 + 蛋白" */
export const STIR_FRY_GROUP: readonly CookingMethodValue[] = [
  CookingMethod.STIR_FRY,
  CookingMethod.SHALLOW_FRY,
];

/** 炖煮类：菜名模板 "蛋白 + 方法 + 蔬菜" */
export const STEW_GROUP: readonly CookingMethodValue[] = [
  CookingMethod.STEW,
  CookingMethod.BOIL,
  CookingMethod.SIMMER,
  CookingMethod.BRAISE,
  CookingMethod.PRESSURE_COOK,
];

/** 蒸类：菜名模板 "清蒸蛋白配蔬菜" */
export const STEAM_GROUP: readonly CookingMethodValue[] = [CookingMethod.STEAM];

/** 烤/烧/焗类：菜名模板 "烤蛋白配蔬菜" */
export const ROAST_GROUP: readonly CookingMethodValue[] = [
  CookingMethod.ROAST,
  CookingMethod.BAKE,
  CookingMethod.GRILL,
  CookingMethod.BARBECUE,
];

/** 煎/炸类：菜名模板 "煎蛋白配蔬菜" */
export const FRY_GROUP: readonly CookingMethodValue[] = [
  CookingMethod.PAN_FRY,
  CookingMethod.DEEP_FRY,
];

/** 可直接用于素菜菜名前缀的方法 */
export const VEGGIE_PREFIX_METHODS: readonly CookingMethodValue[] = [
  CookingMethod.STIR_FRY,
  CookingMethod.STEAM,
  CookingMethod.ROAST,
  CookingMethod.BOIL,
];

// ─── 设备→烹饪方式映射 ───

export const EQUIPMENT_COOKING_MAP: Record<string, CookingMethodValue[]> = {
  oven: [CookingMethod.BAKE, CookingMethod.ROAST],
  microwave: [CookingMethod.MICROWAVE],
  air_fryer: [CookingMethod.AIR_FRY],
  steamer: [CookingMethod.STEAM],
  rice_cooker: [CookingMethod.RICE_COOK],
};

/** 无灶具时不可用的烹饪方式 */
export const STOVE_REQUIRED_METHODS: readonly CookingMethodValue[] = [
  CookingMethod.STIR_FRY,
  CookingMethod.PAN_FRY,
  CookingMethod.DEEP_FRY,
  CookingMethod.SHALLOW_FRY,
];

// ─── 嵌入向量索引映射 ───

/** 用于 food-embedding one-hot 编码的烹饪方式索引 */
export const COOKING_METHOD_EMBEDDING_INDEX: Record<string, number> = {
  [CookingMethod.STEAM]: 0,
  [CookingMethod.BOIL]: 1,
  [CookingMethod.STIR_FRY]: 2,
  [CookingMethod.ROAST]: 3,
  [CookingMethod.PAN_FRY]: 4,
  [CookingMethod.RAW]: 5,
};

// ─── 质感映射 ───

export const COOKING_TEXTURE_MAP: Record<string, string> = {
  [CookingMethod.STIR_FRY]: 'crispy',
  [CookingMethod.DEEP_FRY]: 'crispy',
  [CookingMethod.SHALLOW_FRY]: 'crispy',
  [CookingMethod.PAN_FRY]: 'crispy',
  [CookingMethod.STEAM]: 'soft',
  [CookingMethod.BOIL]: 'soft',
  [CookingMethod.SIMMER]: 'tender',
  [CookingMethod.STEW]: 'tender',
  [CookingMethod.BRAISE]: 'tender',
  [CookingMethod.PRESSURE_COOK]: 'tender',
  [CookingMethod.BAKE]: 'crispy',
  [CookingMethod.ROAST]: 'crispy',
  [CookingMethod.GRILL]: 'chewy',
  [CookingMethod.BARBECUE]: 'chewy',
  [CookingMethod.RAW]: 'crunchy',
  [CookingMethod.AIR_FRY]: 'crispy',
  [CookingMethod.SMOKE]: 'chewy',
  [CookingMethod.PICKLE]: 'crunchy',
  [CookingMethod.FERMENT]: 'soft',
};

// ─── AI 补全 prompt 用的可选值列表 ───

/**
 * AI 补全 prompt 中 cookingMethods 字段描述。
 * 列出所有合法的烹饪方式短码，首元素为主要方式。
 */
export const COOKING_METHODS_FIELD_DESC =
  '[string[]] cooking_methods Array of applicable cooking methods, first element is primary method. ' +
  `Values: ${ALL_COOKING_METHODS.join('/')}. ` +
  'Include all applicable methods, not just the primary one.';
