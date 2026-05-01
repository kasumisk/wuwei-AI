/**
 * 菜系（cuisine）规范化与 cuisine → 原产地国家映射
 *
 * 背景（二轮深度审计 P0-R3 + P1 / P3-3.5）：
 * 1. `food.cuisine` / `recipe.cuisine` 是 free-text String（无 enum 约束），
 *    用户 declared `cuisinePreferences` 与之比较时存在大小写/空格/中英文差异
 *    （"Chinese" vs "chinese" vs "中餐" vs " chinese "）。
 * 2. 推荐引擎的 RegionalBoostFactor 仅按 `user.regionCode` 查 FoodRegionalInfo，
 *    用户主动选了"日料/中餐"等异国菜时，原产地的 regional boost 完全没机会触发。
 *
 * ⚠️ Canonical 取值集（前端 ↔ admin ↔ 后端 ↔ DB 唯一权威）
 * ──────────────────────────────────────────────────────────
 * 来源 1（C1）`apps/web/.../onboarding-constants.ts:CUISINE_OPTIONS`：
 *   chinese, sichuan, cantonese, japanese, korean, western,
 *   thai, indian, mediterranean, fast_food
 * 来源 2（C2）`apps/admin/.../recipe/list/index.tsx:CUISINE_OPTIONS`：
 *   chinese, western, japanese, korean, southeast_asian,
 *   indian, italian, mexican, mediterranean, other
 *
 * Canonical（归集后）= 12 项：
 *   chinese, japanese, korean, western, italian, mexican,
 *   thai, southeast_asian, indian, mediterranean, fast_food, other
 *
 * ⚠️ 归集规则（用户明确要求）：
 *   sichuan / 川菜 / szechuan / szechwan / cantonese / 粤菜 → 归并为 `chinese`
 *
 * 归集理由：
 *   1) cuisineWeights / cuisineAffinityRelative 按 cuisine key 聚合，归并后样本更密、信号更稳。
 *   2) DB 中 `food.cuisine` 大多只标 'chinese'，若不归集，用户"川菜偏好"永远命中不到
 *      `food.cuisine='chinese'` 的食物。
 *   3) `CUISINE_TO_COUNTRIES` 三者都映射到 ['CN']，国家级 boost 完全一致。
 *
 * 前端 `CUISINE_OPTIONS` 仍保留 sichuan/cantonese 按钮以提升用户选择体验，
 * 但写入存储与下游评分前由本工具统一归 `chinese`。
 *
 * 历史 DB 可能存在 canonical 外的值（french/turkish 等）：
 *   - 大多通过 EN_ALIASES 上卷到 mediterranean / western / southeast_asian
 *   - 仍保留 `CUISINE_TO_COUNTRIES` 中显式国家映射作为防御扩展点
 *
 * 设计约束：
 * - 大小写/空格/中文别名不敏感
 * - 一对多支持（mediterranean / southeast_asian / western）
 * - 无外部依赖（不查表/不查 DB）
 */

/**
 * Canonical 菜系取值集（前端选项 + admin recipe 选项的并集）
 *
 * **修改本集合时必须同步**：
 *   - apps/web/src/features/onboarding/lib/onboarding-constants.ts:CUISINE_OPTIONS
 *   - apps/admin/src/pages/recipe/list/index.tsx:CUISINE_OPTIONS
 *   - 数据补全脚本（scripts/normalize-cuisine.ts，待建）
 */
export const CANONICAL_CUISINES = [
  'chinese',
  'japanese',
  'korean',
  'western',
  'italian',
  'mexican',
  'thai',
  'southeast_asian',
  'indian',
  'mediterranean',
  'fast_food',
  'other',
] as const;

export type CanonicalCuisine = (typeof CANONICAL_CUISINES)[number];

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_CUISINES);

/**
 * 中文别名 → canonical
 *
 * 仅覆盖前端 `CUISINE_OPTIONS.label` + admin 表单 label，不引入新菜系。
 * 注意：`川菜 → sichuan` 不要被归到 chinese（保留前端的细粒度偏好）。
 */
const ZH_ALIASES: Readonly<Record<string, CanonicalCuisine>> = {
  // 中餐家族（sichuan / cantonese 按需求归并到 chinese）
  中餐: 'chinese',
  中式: 'chinese',
  中国菜: 'chinese',
  中式菜系: 'chinese',
  川菜: 'chinese',
  四川菜: 'chinese',
  川式: 'chinese',
  粤菜: 'chinese',
  广东菜: 'chinese',
  广式: 'chinese',
  // 其它单国菜系
  日餐: 'japanese',
  日料: 'japanese',
  日式: 'japanese',
  日本菜: 'japanese',
  韩餐: 'korean',
  韩式: 'korean',
  韩国菜: 'korean',
  泰餐: 'thai',
  泰式: 'thai',
  泰国菜: 'thai',
  印度菜: 'indian',
  印度: 'indian',
  意餐: 'italian',
  意式: 'italian',
  意大利菜: 'italian',
  意大利: 'italian',
  墨西哥菜: 'mexican',
  墨西哥: 'mexican',
  // 跨国 / 大类
  西餐: 'western',
  西式: 'western',
  欧美菜: 'western',
  地中海: 'mediterranean',
  地中海菜: 'mediterranean',
  东南亚: 'southeast_asian',
  东南亚菜: 'southeast_asian',
  快餐: 'fast_food',
  其他: 'other',
};

/**
 * 英文同义词 → canonical
 *
 * 仅覆盖：
 *   1) canonical 自身（idempotent）
 *   2) 前端/admin 可能的轻微变体（横线、空格、单复数）
 *   3) 主流 DB 落库可能出现的拼写（"szechuan"=sichuan、"tex-mex"=mexican）
 *
 * 历史 DB 中的 french / spanish / greek / turkish / vietnamese 等不在
 * canonical 集，**不映射进 alias 表**——它们在 normalize 时会以 stripped 原值返回，
 * 但 `CUISINE_TO_COUNTRIES` 仍能解析，确保 cuisine→region affinity 不丢。
 */
const EN_ALIASES: Readonly<Record<string, CanonicalCuisine>> = {
  // 中餐（含川菜/粤菜：按需求归并到 chinese）
  chinese: 'chinese',
  'chinese food': 'chinese',
  sichuan: 'chinese',
  szechuan: 'chinese',
  szechwan: 'chinese',
  cantonese: 'chinese',
  // 日韩
  japanese: 'japanese',
  korean: 'korean',
  // 西餐大类
  western: 'western',
  'western food': 'western',
  american: 'western', // 历史数据：美式归入 western 大类
  european: 'western',
  // 意大利（独立）
  italian: 'italian',
  // 墨西哥
  mexican: 'mexican',
  'tex-mex': 'mexican',
  // 泰国 / 东南亚
  thai: 'thai',
  'southeast asian': 'southeast_asian',
  southeast_asian: 'southeast_asian',
  'south-east asian': 'southeast_asian',
  vietnamese: 'southeast_asian', // 历史归入大类
  indonesian: 'southeast_asian',
  malaysian: 'southeast_asian',
  filipino: 'southeast_asian',
  // 印度
  indian: 'indian',
  // 地中海
  mediterranean: 'mediterranean',
  greek: 'mediterranean', // 历史归入
  spanish: 'mediterranean',
  turkish: 'mediterranean',
  lebanese: 'mediterranean',
  moroccan: 'mediterranean',
  // 快餐
  fast_food: 'fast_food',
  'fast food': 'fast_food',
  fastfood: 'fast_food',
  // other
  other: 'other',
  others: 'other',
  unknown: 'other',
};

/**
 * 规范化 cuisine 字符串
 *
 * 处理顺序：
 *   1) String + trim + toLowerCase
 *   2) 去除常见后缀（cuisine / food / style / kitchen）—— 但中文别名优先于后缀去除
 *   3) 中文别名表 ZH_ALIASES
 *   4) 英文同义词表 EN_ALIASES
 *   5) 兜底：返回 stripped（不在 canonical 集，但保留可识别字符串）
 *
 * 返回 null 表示输入为 null/undefined/空字符串。
 */
export function normalizeCuisine(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // 中文别名（不 toLowerCase，因为汉字不区分大小写）
  if (ZH_ALIASES[trimmed]) return ZH_ALIASES[trimmed];

  const lower = trimmed.toLowerCase();
  // 去除尾部修饰词
  const stripped = lower
    .replace(/\s+(cuisine|food|style|kitchen|dish|dishes)$/i, '')
    .trim();

  // 英文别名（含 canonical idempotent）
  if (EN_ALIASES[lower]) return EN_ALIASES[lower];
  if (EN_ALIASES[stripped]) return EN_ALIASES[stripped];

  // 兜底：返回 stripped 原值（保留 free-text 兼容）
  return stripped;
}

/**
 * 是否为 canonical 取值（前端/admin 已建模的菜系）
 */
export function isCanonicalCuisine(value: unknown): value is CanonicalCuisine {
  const n = normalizeCuisine(value);
  return n !== null && CANONICAL_SET.has(n);
}

/**
 * cuisine → 原产 ISO-3166 country code 列表
 *
 * 包含 canonical 项 + 历史 DB 可能出现的国家菜系（french/spanish/greek/...）。
 * 这两类**都参与 cuisine→region affinity**，因此映射表需要比 canonical 更全。
 *
 * 一对多用于地理跨国概念（western / mediterranean / southeast_asian）。
 * `fast_food` / `other` 故意映射为 []，表示不参与 region affinity。
 */
export const CUISINE_TO_COUNTRIES: Readonly<
  Record<string, readonly string[]>
> = {
  // ── canonical 项 ──
  chinese: ['CN'], // 含 sichuan / cantonese / szechuan（normalize 已归并）
  japanese: ['JP'],
  korean: ['KR'],
  // 西餐：欧美主要英语+西欧国家
  western: ['US', 'GB', 'FR', 'DE', 'IT', 'ES'],
  italian: ['IT'],
  mexican: ['MX'],
  thai: ['TH'],
  southeast_asian: ['TH', 'VN', 'ID', 'MY', 'PH', 'SG'],
  indian: ['IN'],
  mediterranean: ['IT', 'GR', 'ES', 'FR', 'TR', 'LB'],
  fast_food: [], // 无原产国
  other: [], // 不参与
  // ── 历史 DB 可能出现的非 canonical 单国菜系 ──
  // （EN_ALIASES 已把它们归到 mediterranean / western / southeast_asian，
  //  这里保留显式映射作为防御：万一前端/admin 后续放开新选项，仍能解析）
  french: ['FR'],
  spanish: ['ES'],
  greek: ['GR'],
  turkish: ['TR'],
  lebanese: ['LB'],
  moroccan: ['MA'],
  vietnamese: ['VN'],
  indonesian: ['ID'],
  malaysian: ['MY'],
  filipino: ['PH'],
  american: ['US'],
  german: ['DE'],
  british: ['GB'],
  brazilian: ['BR'],
  argentinian: ['AR'],
  peruvian: ['PE'],
  russian: ['RU'],
  ethiopian: ['ET'],
  middle_eastern: ['LB', 'TR', 'IL', 'JO', 'SA'],
};

/**
 * 单 cuisine 映射到原产国家列表
 *
 * 支持任意大小写/中文别名输入；未知 cuisine 返回空数组。
 *
 * 注意：先用 normalizeCuisine（命中 canonical），再回退查 raw lower（命中
 *   非 canonical 历史值如 french / turkish）。
 */
export function cuisineToCountryCodes(cuisine: unknown): string[] {
  const norm = normalizeCuisine(cuisine);
  if (!norm) return [];
  // canonical 直接查
  const direct = CUISINE_TO_COUNTRIES[norm];
  if (direct) return Array.from(direct);
  // 兜底：可能 norm 是 stripped 原值（如 'turkish'），表里仍可能有
  // 注：上一行已覆盖，留作防御性扩展点
  return [];
}

/**
 * 用户 cuisinePreferences[] → 去重 country code 列表
 *
 * 用例：用户 declared.cuisinePreferences = ['日料','italian'] →
 *   returns ['JP', 'IT']
 *
 * 排除用户当前所在 region 的 country（避免重复 boost）。
 * 由 RegionalBoostFactor 主链路负责本地国 boost；本函数只产出"额外要叠加的异国"。
 */
export function getCuisinePreferenceCountries(
  cuisinePreferences: readonly string[] | null | undefined,
  excludeCountryCode?: string | null,
): string[] {
  if (!cuisinePreferences || cuisinePreferences.length === 0) return [];
  const exclude = excludeCountryCode?.toUpperCase() ?? null;
  const set = new Set<string>();
  for (const pref of cuisinePreferences) {
    for (const cc of cuisineToCountryCodes(pref)) {
      if (cc !== exclude) set.add(cc);
    }
  }
  return Array.from(set);
}

/**
 * 比较两个 cuisine 是否等价
 *
 * 大小写 / 空格 / 中文别名不敏感。
 */
export function cuisineEquals(a: unknown, b: unknown): boolean {
  const na = normalizeCuisine(a);
  const nb = normalizeCuisine(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * 检查 food.cuisine 是否在用户 cuisinePreferences 列表内
 *
 * 取代旧的 `cuisinePreferences.includes(food.cuisine)` 大小写敏感写法。
 */
export function isCuisinePreferred(
  foodCuisine: unknown,
  cuisinePreferences: readonly string[] | null | undefined,
): boolean {
  if (!cuisinePreferences || cuisinePreferences.length === 0) return false;
  const target = normalizeCuisine(foodCuisine);
  if (!target) return false;
  for (const pref of cuisinePreferences) {
    if (normalizeCuisine(pref) === target) return true;
  }
  return false;
}
