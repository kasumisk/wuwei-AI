/**
 * V8.8 数据修复脚本：用 food_portion_guides 回填并重建 food_translations.serving_desc。
 *
 * 背景：
 *   food_translations.serving_desc 历史上被当作“按 locale 翻译后的份量说明”维护，
 *   但份量本质上来自结构化表 food_portion_guides，导致翻译表里出现大量错误/不一致数据。
 *
 * 本脚本的目标：
 *   1. 以 FoodPortionGuide.standardServingDesc / standardServingG 为唯一事实源
 *   2. 按 locale 重新生成 food_translations.serving_desc
 *   3. 清洗错误的历史翻译，并填补空值
 *
 * 规则摘要：
 *   R1  standardServingDesc 为中文模板（如“每100g”“1份约200g”）
 *       → 按固定规则翻译为目标 locale
 *   R2  standardServingDesc 已是英文/USDA 份量（如“1 cup cooked (186g)”）
 *       → 以该值为源文本，做轻量本地化
 *   R3  无法可靠解析或 standardServingDesc 为空
 *       → 使用 standardServingG 生成兜底描述
 *
 * 用法：
 *   # 试运行（默认）
 *   npx ts-node -r tsconfig-paths/register src/scripts/tools/fix-food-translation-serving-desc.ts
 *
 *   # 实际写库
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register src/scripts/tools/fix-food-translation-serving-desc.ts
 *
 *   # 只处理部分 locale
 *   LOCALES=en-US,zh-CN,ja-JP DRY_RUN=false npx ts-node -r tsconfig-paths/register src/scripts/tools/fix-food-translation-serving-desc.ts
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN !== 'false';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 200);
const LIMIT = Number(process.env.LIMIT || 0);
const MAX_SAMPLES = 25;

const DEFAULT_LOCALES = [
  'en-US',
  'es-ES',
  'ja-JP',
  'ko-KR',
  'zh-CN',
  'zh-TW',
  'AU',
] as const;

type Locale = (typeof DEFAULT_LOCALES)[number];

type SourceKind = 'cjk-template' | 'english-direct' | 'grams-fallback';
type Strategy = 'zh-direct' | 'english-direct' | 'localized-from-english' | 'grams-fallback';
type FractionItem = 'pie' | 'pizza' | 'cake' | 'crust';

interface CandidateRow {
  translationId: string;
  foodId: string;
  locale: string;
  foodName: string;
  currentServingDesc: string | null;
  standardServingDesc: string | null;
  standardServingG: number;
}

interface PlannedChange {
  translationId: string;
  foodId: string;
  locale: string;
  foodName: string;
  currentServingDesc: string | null;
  nextServingDesc: string;
  sourceKind: SourceKind;
  strategy: Strategy;
}

const CJK_RE = /[\u3400-\u9fff]/;
const LAST_GRAMS_RE = /\((\d+(?:\.\d+)?)\s*g\)\s*$/i;
const AMOUNT_LABEL_RE = /^([^\s]+)\s+(.+)$/;
const INCH_VALUE_RE = '\\d+(?:-\\d+\\/\\d+|\\/\\d+|(?:\\.\\d+)?)';

const ZH_MEASURE_TO_EN: Record<string, string> = {
  份: 'portion',
  碗: 'bowl',
  个: 'piece',
  片: 'slice',
  杯: 'cup',
  勺: 'spoon',
  汤匙: 'tbsp',
  茶匙: 'tsp',
  包: 'pack',
  块: 'piece',
  条: 'piece',
  只: 'piece',
  枚: 'piece',
  根: 'piece',
  串: 'skewer',
  张: 'sheet',
  盒: 'box',
  罐: 'can',
  瓶: 'bottle',
  袋: 'bag',
};

const LABEL_REPLACEMENTS: Record<string, Array<[RegExp, string]>> = {
  'zh-CN': [
    [/\bwithout pits\b/gi, '去核'],
    [/\bsolids and liquids\b/gi, '固液混合'],
    [/\bwith milk\b/gi, '加奶'],
    [/\bwith gravy\b/gi, '配肉汁'],
    [/\bwith icing\b/gi, '配糖霜'],
    [/\bor\b/gi, '或'],
    [/\bwhole or sliced\b/gi, '整个或切片'],
    [/\bhalves or slices\b/gi, '对半或切片'],
    [/\bdrained solids\b/gi, '沥干固形物'],
    [/\bdry mix\b/gi, '干粉'],
    [/\bdry\b/gi, '干'],
    [/\bprepared\b/gi, '冲调后'],
    [/\bcooked\b/gi, '熟制'],
    [/\braw\b/gi, '生'],
    [/\bdrained\b/gi, '沥干'],
    [/\bcanned\b/gi, '罐装'],
    [/\bcondensed\b/gi, '浓缩'],
    [/\bconcentrate\b/gi, '浓缩液'],
    [/\buncooked\b/gi, '未烹调'],
    [/\bblanched\b/gi, '焯水'],
    [/\bgrilled\b/gi, '烤制'],
    [/\bcubed\b/gi, '切块'],
    [/\bcubes\b/gi, '块'],
    [/\bdiced\b/gi, '切丁'],
    [/\bcrushed\b/gi, '压碎'],
    [/\bchopped\b/gi, '切碎'],
    [/\bsliced\b/gi, '切片'],
    [/\bshredded\b/gi, '切丝'],
    [/\bgrated\b/gi, '磨碎'],
    [/\bground\b/gi, '粉末'],
    [/\bfresh\b/gi, '鲜'],
    [/\bpowder\b/gi, '粉'],
    [/\bsections\b/gi, '瓣'],
    [/\bshelled\b/gi, '去壳'],
    [/\bhalves\b/gi, '对半'],
    [/\bwhole\b/gi, '整颗'],
    [/\bfrozen\b/gi, '冷冻'],
    [/\bbrewed\b/gi, '冲泡后'],
    [/\bpopped\b/gi, '爆开'],
    [/\bpitted\b/gi, '去核'],
    [/\bstewed\b/gi, '炖煮'],
    [/\bdried\b/gi, '干制'],
    [/\bmedium\b/gi, '中等'],
    [/\border\b/gi, '份'],
    [/\broot\b/gi, '根'],
    [/\bkernel\b/gi, '籽粒'],
    [/\bkernels\b/gi, '籽粒'],
    [/\bgrain\b/gi, '谷粒'],
    [/\bgrapes\b/gi, '葡萄'],
    [/\bmushrooms\b/gi, '蘑菇'],
    [/\bpods\b/gi, '荚'],
    [/\bprunes\b/gi, '西梅'],
    [/\bdia\b/gi, '直径'],
    [/\bdiameter\b/gi, '直径'],
    [/\bfl oz\b/gi, '液量盎司'],
    [/\bml\b/gi, '毫升'],
    [/\btablespoons?\b/gi, '汤匙'],
    [/\btbsp\b/gi, '汤匙'],
    [/\bteaspoons?\b/gi, '茶匙'],
    [/\btsp\b/gi, '茶匙'],
    [/\bportion\b/gi, '份'],
    [/\bserving\b/gi, '份'],
    [/\bbowl\b/gi, '碗'],
    [/\bcups?\b/gi, '杯'],
    [/\bslices?\b/gi, '片'],
    [/\bpieces?\b/gi, '个'],
    [/\bcookies?\b/gi, '块饼干'],
    [/\bcrackers?\b/gi, '片饼干'],
    [/\bmuffins?\b/gi, '个松饼'],
    [/\bdoughnuts?\b/gi, '个甜甜圈'],
    [/\bbiscuits?\b/gi, '块饼'],
    [/\bbars?\b/gi, '条'],
    [/\bjars?\b/gi, '罐'],
    [/\bglasses\b/gi, '杯'],
    [/\bglass\b/gi, '杯'],
    [/\bcontainers?\b/gi, '盒'],
    [/\bcans?\b/gi, '罐'],
    [/\bpackages?\b/gi, '包'],
    [/\bpackets?\b/gi, '袋'],
    [/\bpacks?\b/gi, '包'],
    [/\bscoops?\b/gi, '勺'],
    [/\bfrankfurters?\b/gi, '根香肠'],
    [/\bdrumsticks?\b/gi, '鸡腿'],
    [/\blinks?\b/gi, '根'],
    [/\bwafers?\b/gi, '片威化'],
    [/\bbrownies?\b/gi, '块布朗尼'],
    [/\bbagels?\b/gi, '个贝果'],
    [/\bburritos?\b/gi, '个卷饼'],
    [/\bpupusas?\b/gi, '个普普萨'],
    [/\bsalads?\b/gi, '份沙拉'],
    [/\bwaffles?\b/gi, '块华夫饼'],
    [/\bcakes?\b/gi, '块蛋糕'],
    [/\bpatty\b/gi, '块肉饼'],
    [/\bpears?\b/gi, '个梨'],
    [/\btortillas?\b/gi, '张薄饼'],
    [/\bblocks?\b/gi, '块'],
    [/\bsandwich cracker\b/gi, '个夹心饼干'],
    [/\bsandwich(?:es)?\b/gi, '个三明治'],
    [/\brolls?\b/gi, '卷'],
    [/\bbuns?\b/gi, '个'],
    [/\bbottles?\b/gi, '瓶'],
    [/\bboxes\b/gi, '盒'],
    [/\bbox\b/gi, '盒'],
    [/\bbags?\b/gi, '袋'],
    [/\bskewers?\b/gi, '串'],
    [/\bsheets?\b/gi, '张'],
    [/\boz\b/gi, '盎司'],
  ],
  'zh-TW': [
    [/\bwithout pits\b/gi, '去核'],
    [/\bsolids and liquids\b/gi, '固液混合'],
    [/\bwith milk\b/gi, '加奶'],
    [/\bwith gravy\b/gi, '配肉汁'],
    [/\bwith icing\b/gi, '配糖霜'],
    [/\bor\b/gi, '或'],
    [/\bwhole or sliced\b/gi, '整顆或切片'],
    [/\bhalves or slices\b/gi, '對半或切片'],
    [/\bdrained solids\b/gi, '瀝乾固形物'],
    [/\bdry mix\b/gi, '乾粉'],
    [/\bdry\b/gi, '乾'],
    [/\bprepared\b/gi, '沖調後'],
    [/\bcooked\b/gi, '熟製'],
    [/\braw\b/gi, '生'],
    [/\bdrained\b/gi, '瀝乾'],
    [/\bcanned\b/gi, '罐裝'],
    [/\bcondensed\b/gi, '濃縮'],
    [/\bconcentrate\b/gi, '濃縮液'],
    [/\buncooked\b/gi, '未烹調'],
    [/\bblanched\b/gi, '汆燙'],
    [/\bgrilled\b/gi, '烤製'],
    [/\bcubed\b/gi, '切塊'],
    [/\bcubes\b/gi, '塊'],
    [/\bdiced\b/gi, '切丁'],
    [/\bcrushed\b/gi, '壓碎'],
    [/\bchopped\b/gi, '切碎'],
    [/\bsliced\b/gi, '切片'],
    [/\bshredded\b/gi, '切絲'],
    [/\bgrated\b/gi, '磨碎'],
    [/\bground\b/gi, '粉末'],
    [/\bfresh\b/gi, '鮮'],
    [/\bpowder\b/gi, '粉'],
    [/\bsections\b/gi, '瓣'],
    [/\bshelled\b/gi, '去殼'],
    [/\bhalves\b/gi, '對半'],
    [/\bwhole\b/gi, '整顆'],
    [/\bfrozen\b/gi, '冷凍'],
    [/\bbrewed\b/gi, '沖泡後'],
    [/\bpopped\b/gi, '爆開'],
    [/\bpitted\b/gi, '去核'],
    [/\bstewed\b/gi, '燉煮'],
    [/\bdried\b/gi, '乾製'],
    [/\bmedium\b/gi, '中等'],
    [/\border\b/gi, '份'],
    [/\broot\b/gi, '根'],
    [/\bkernel\b/gi, '籽粒'],
    [/\bkernels\b/gi, '籽粒'],
    [/\bgrain\b/gi, '穀粒'],
    [/\bgrapes\b/gi, '葡萄'],
    [/\bmushrooms\b/gi, '蘑菇'],
    [/\bpods\b/gi, '莢'],
    [/\bprunes\b/gi, '西梅'],
    [/\bdia\b/gi, '直徑'],
    [/\bdiameter\b/gi, '直徑'],
    [/\bfl oz\b/gi, '液量盎司'],
    [/\bml\b/gi, '毫升'],
    [/\btablespoons?\b/gi, '湯匙'],
    [/\btbsp\b/gi, '湯匙'],
    [/\bteaspoons?\b/gi, '茶匙'],
    [/\btsp\b/gi, '茶匙'],
    [/\bportion\b/gi, '份'],
    [/\bserving\b/gi, '份'],
    [/\bbowl\b/gi, '碗'],
    [/\bcups?\b/gi, '杯'],
    [/\bslices?\b/gi, '片'],
    [/\bpieces?\b/gi, '個'],
    [/\bcookies?\b/gi, '塊餅乾'],
    [/\bcrackers?\b/gi, '片餅乾'],
    [/\bmuffins?\b/gi, '個鬆餅'],
    [/\bdoughnuts?\b/gi, '個甜甜圈'],
    [/\bbiscuits?\b/gi, '塊餅'],
    [/\bbars?\b/gi, '條'],
    [/\bjars?\b/gi, '罐'],
    [/\bglasses\b/gi, '杯'],
    [/\bglass\b/gi, '杯'],
    [/\bcontainers?\b/gi, '盒'],
    [/\bcans?\b/gi, '罐'],
    [/\bpackages?\b/gi, '包'],
    [/\bpackets?\b/gi, '袋'],
    [/\bpacks?\b/gi, '包'],
    [/\bscoops?\b/gi, '勺'],
    [/\bfrankfurters?\b/gi, '根香腸'],
    [/\bdrumsticks?\b/gi, '雞腿'],
    [/\blinks?\b/gi, '根'],
    [/\bwafers?\b/gi, '片威化'],
    [/\bbrownies?\b/gi, '塊布朗尼'],
    [/\bbagels?\b/gi, '個貝果'],
    [/\bburritos?\b/gi, '個捲餅'],
    [/\bpupusas?\b/gi, '個普普薩'],
    [/\bsalads?\b/gi, '份沙拉'],
    [/\bwaffles?\b/gi, '塊格子鬆餅'],
    [/\bcakes?\b/gi, '塊蛋糕'],
    [/\bpatty\b/gi, '塊肉餅'],
    [/\bpears?\b/gi, '個梨'],
    [/\btortillas?\b/gi, '張薄餅'],
    [/\bblocks?\b/gi, '塊'],
    [/\bsandwich cracker\b/gi, '個夾心餅乾'],
    [/\bsandwich(?:es)?\b/gi, '個三明治'],
    [/\brolls?\b/gi, '卷'],
    [/\bbuns?\b/gi, '個'],
    [/\bbottles?\b/gi, '瓶'],
    [/\bboxes\b/gi, '盒'],
    [/\bbox\b/gi, '盒'],
    [/\bbags?\b/gi, '袋'],
    [/\bskewers?\b/gi, '串'],
    [/\bsheets?\b/gi, '張'],
    [/\boz\b/gi, '盎司'],
  ],
  'ja-JP': [
    [/\bwithout pits\b/gi, '種なし'],
    [/\bsolids and liquids\b/gi, '固形分と液体'],
    [/\bwith milk\b/gi, '牛乳入り'],
    [/\bwith gravy\b/gi, 'グレービー付き'],
    [/\bwith icing\b/gi, 'アイシング付き'],
    [/\bor\b/gi, 'または'],
    [/\bwhole or sliced\b/gi, '丸ごとまたはスライス'],
    [/\bhalves or slices\b/gi, '半割りまたはスライス'],
    [/\bdrained solids\b/gi, '水切り固形分'],
    [/\bdry mix\b/gi, '乾燥ミックス'],
    [/\bdry\b/gi, '乾燥'],
    [/\bprepared\b/gi, '調理後'],
    [/\bcooked\b/gi, '調理済み'],
    [/\braw\b/gi, '生'],
    [/\bdrained\b/gi, '水切り'],
    [/\bcanned\b/gi, '缶詰'],
    [/\bcondensed\b/gi, '濃縮'],
    [/\bconcentrate\b/gi, '濃縮液'],
    [/\buncooked\b/gi, '未調理'],
    [/\bblanched\b/gi, '湯通し'],
    [/\bgrilled\b/gi, 'グリル'],
    [/\bcubed\b/gi, '角切り'],
    [/\bcubes\b/gi, '角切り'],
    [/\bdiced\b/gi, 'さいの目切り'],
    [/\bcrushed\b/gi, '砕いた'],
    [/\bchopped\b/gi, '刻み'],
    [/\bsliced\b/gi, 'スライス'],
    [/\bshredded\b/gi, '細切り'],
    [/\bgrated\b/gi, 'すりおろし'],
    [/\bground\b/gi, '粉末'],
    [/\bfresh\b/gi, '生'],
    [/\bpowder\b/gi, '粉末'],
    [/\bsections\b/gi, '房'],
    [/\bshelled\b/gi, '殻むき'],
    [/\bhalves\b/gi, '半割り'],
    [/\bwhole\b/gi, '丸ごと'],
    [/\bfrozen\b/gi, '冷凍'],
    [/\bbrewed\b/gi, '抽出後'],
    [/\bpopped\b/gi, 'ポップ後'],
    [/\bpitted\b/gi, '種抜き'],
    [/\bstewed\b/gi, '煮込み'],
    [/\bdried\b/gi, '乾燥'],
    [/\bmedium\b/gi, '中サイズ'],
    [/\border\b/gi, '注文サイズ'],
    [/\broot\b/gi, '根'],
    [/\bkernel\b/gi, '粒'],
    [/\bkernels\b/gi, '粒'],
    [/\bgrain\b/gi, '穀粒'],
    [/\bgrapes\b/gi, 'ぶどう'],
    [/\bmushrooms\b/gi, 'きのこ'],
    [/\bpods\b/gi, 'さや'],
    [/\bprunes\b/gi, 'プルーン'],
    [/\bdia\b/gi, '直径'],
    [/\bdiameter\b/gi, '直径'],
    [/\bfl oz\b/gi, '液量オンス'],
    [/\bml\b/gi, 'mL'],
    [/\btablespoons?\b/gi, '大さじ'],
    [/\btbsp\b/gi, '大さじ'],
    [/\bteaspoons?\b/gi, '小さじ'],
    [/\btsp\b/gi, '小さじ'],
    [/\bportion\b/gi, '食分'],
    [/\bserving\b/gi, '食分'],
    [/\bbowl\b/gi, '杯'],
    [/\bcups?\b/gi, 'カップ'],
    [/\bslices?\b/gi, '枚'],
    [/\bpieces?\b/gi, '個'],
    [/\bcookies?\b/gi, '枚クッキー'],
    [/\bcrackers?\b/gi, '枚クラッカー'],
    [/\bmuffins?\b/gi, '個マフィン'],
    [/\bdoughnuts?\b/gi, '個ドーナツ'],
    [/\bbiscuits?\b/gi, '個ビスケット'],
    [/\bbars?\b/gi, '本'],
    [/\bjars?\b/gi, '瓶'],
    [/\bglasses\b/gi, '杯'],
    [/\bglass\b/gi, '杯'],
    [/\bcontainers?\b/gi, '個容器'],
    [/\bcans?\b/gi, '缶'],
    [/\bpackages?\b/gi, '袋'],
    [/\bpackets?\b/gi, '袋'],
    [/\bpacks?\b/gi, '袋'],
    [/\bscoops?\b/gi, 'スクープ'],
    [/\bfrankfurters?\b/gi, '本フランクフルト'],
    [/\bdrumsticks?\b/gi, 'ドラムスティック'],
    [/\blinks?\b/gi, '本'],
    [/\bwafers?\b/gi, '枚ウエハース'],
    [/\bbrownies?\b/gi, '個ブラウニー'],
    [/\bbagels?\b/gi, '個ベーグル'],
    [/\bburritos?\b/gi, '個ブリトー'],
    [/\bpupusas?\b/gi, '個ププサ'],
    [/\bsalads?\b/gi, '皿サラダ'],
    [/\bwaffles?\b/gi, '枚ワッフル'],
    [/\bcakes?\b/gi, '個ケーキ'],
    [/\bpatty\b/gi, '枚パティ'],
    [/\bpears?\b/gi, '個洋梨'],
    [/\btortillas?\b/gi, '枚トルティーヤ'],
    [/\bblocks?\b/gi, '個ブロック'],
    [/\bsandwich cracker\b/gi, '個サンドクラッカー'],
    [/\bsandwich(?:es)?\b/gi, '個サンドイッチ'],
    [/\brolls?\b/gi, '個ロール'],
    [/\bbuns?\b/gi, '個'],
    [/\bbottles?\b/gi, '本'],
    [/\bboxes\b/gi, '箱'],
    [/\bbox\b/gi, '箱'],
    [/\bbags?\b/gi, '袋'],
    [/\bskewers?\b/gi, '串'],
    [/\bsheets?\b/gi, '枚'],
    [/\boz\b/gi, 'オンス'],
  ],
  'ko-KR': [
    [/\bwithout pits\b/gi, '씨 제거'],
    [/\bsolids and liquids\b/gi, '고형분과 액체'],
    [/\bwith milk\b/gi, '우유 포함'],
    [/\bwith gravy\b/gi, '그레이비 포함'],
    [/\bwith icing\b/gi, '아이싱 포함'],
    [/\bor\b/gi, '또는'],
    [/\bwhole or sliced\b/gi, '통째 또는 슬라이스'],
    [/\bhalves or slices\b/gi, '반쪽 또는 슬라이스'],
    [/\bdrained solids\b/gi, '고형분만 건짐'],
    [/\bdry mix\b/gi, '건식 믹스'],
    [/\bdry\b/gi, '건조'],
    [/\bprepared\b/gi, '조리 후'],
    [/\bcooked\b/gi, '조리됨'],
    [/\braw\b/gi, '생'],
    [/\bdrained\b/gi, '건짐'],
    [/\bcanned\b/gi, '통조림'],
    [/\bcondensed\b/gi, '농축'],
    [/\bconcentrate\b/gi, '농축액'],
    [/\buncooked\b/gi, '비조리'],
    [/\bblanched\b/gi, '데친'],
    [/\bgrilled\b/gi, '구운'],
    [/\bcubed\b/gi, '깍둑썰기'],
    [/\bcubes\b/gi, '깍둑썰기'],
    [/\bdiced\b/gi, '깍둑썰기'],
    [/\bcrushed\b/gi, '으깬'],
    [/\bchopped\b/gi, '잘게 썬'],
    [/\bsliced\b/gi, '슬라이스'],
    [/\bshredded\b/gi, '채 썬'],
    [/\bgrated\b/gi, '간 것'],
    [/\bground\b/gi, '가루'],
    [/\bfresh\b/gi, '생'],
    [/\bpowder\b/gi, '가루'],
    [/\bsections\b/gi, '쪽'],
    [/\bshelled\b/gi, '껍질 제거'],
    [/\bhalves\b/gi, '반쪽'],
    [/\bwhole\b/gi, '통째'],
    [/\bfrozen\b/gi, '냉동'],
    [/\bbrewed\b/gi, '우린 후'],
    [/\bpopped\b/gi, '팝콘 상태'],
    [/\bpitted\b/gi, '씨 제거'],
    [/\bstewed\b/gi, '조림'],
    [/\bdried\b/gi, '건조'],
    [/\bmedium\b/gi, '중간 크기'],
    [/\border\b/gi, '주문분'],
    [/\broot\b/gi, '뿌리'],
    [/\bkernel\b/gi, '알갱이'],
    [/\bkernels\b/gi, '알갱이'],
    [/\bgrain\b/gi, '곡립'],
    [/\bgrapes\b/gi, '포도'],
    [/\bmushrooms\b/gi, '버섯'],
    [/\bpods\b/gi, '꼬투리'],
    [/\bprunes\b/gi, '프룬'],
    [/\bdia\b/gi, '지름'],
    [/\bdiameter\b/gi, '지름'],
    [/\bfl oz\b/gi, '액량 온스'],
    [/\bml\b/gi, 'mL'],
    [/\btablespoons?\b/gi, '큰술'],
    [/\btbsp\b/gi, '큰술'],
    [/\bteaspoons?\b/gi, '작은술'],
    [/\btsp\b/gi, '작은술'],
    [/\bportion\b/gi, '인분'],
    [/\bserving\b/gi, '인분'],
    [/\bbowl\b/gi, '그릇'],
    [/\bcups?\b/gi, '컵'],
    [/\bslices?\b/gi, '조각'],
    [/\bpieces?\b/gi, '개'],
    [/\bcookies?\b/gi, '개 쿠키'],
    [/\bcrackers?\b/gi, '개 크래커'],
    [/\bmuffins?\b/gi, '개 머핀'],
    [/\bdoughnuts?\b/gi, '개 도넛'],
    [/\bbiscuits?\b/gi, '개 비스킷'],
    [/\bbars?\b/gi, '개'],
    [/\bjars?\b/gi, '병'],
    [/\bglasses\b/gi, '잔'],
    [/\bglass\b/gi, '잔'],
    [/\bcontainers?\b/gi, '용기'],
    [/\bcans?\b/gi, '캔'],
    [/\bpackages?\b/gi, '포장'],
    [/\bpackets?\b/gi, '봉지'],
    [/\bpacks?\b/gi, '팩'],
    [/\bscoops?\b/gi, '스쿱'],
    [/\bfrankfurters?\b/gi, '개 프랑크소시지'],
    [/\bdrumsticks?\b/gi, '닭다리'],
    [/\blinks?\b/gi, '개'],
    [/\bwafers?\b/gi, '장 웨이퍼'],
    [/\bbrownies?\b/gi, '개 브라우니'],
    [/\bbagels?\b/gi, '개 베이글'],
    [/\bburritos?\b/gi, '개 부리토'],
    [/\bpupusas?\b/gi, '개 푸푸사'],
    [/\bsalads?\b/gi, '샐러드'],
    [/\bwaffles?\b/gi, '개 와플'],
    [/\bcakes?\b/gi, '조각 케이크'],
    [/\bpatty\b/gi, '장 패티'],
    [/\bpears?\b/gi, '개 배'],
    [/\btortillas?\b/gi, '장 또르띠야'],
    [/\bblocks?\b/gi, '블록'],
    [/\bsandwich cracker\b/gi, '개 샌드 크래커'],
    [/\bsandwich(?:es)?\b/gi, '개 샌드위치'],
    [/\brolls?\b/gi, '개 롤'],
    [/\bbuns?\b/gi, '개'],
    [/\bbottles?\b/gi, '병'],
    [/\bboxes\b/gi, '상자'],
    [/\bbox\b/gi, '상자'],
    [/\bbags?\b/gi, '봉지'],
    [/\bskewers?\b/gi, '꼬치'],
    [/\bsheets?\b/gi, '장'],
    [/\boz\b/gi, '온스'],
  ],
  'es-ES': [
    [/\bwithout pits\b/gi, 'sin hueso'],
    [/\bsolids and liquids\b/gi, 'solidos y liquidos'],
    [/\bwith milk\b/gi, 'con leche'],
    [/\bwith gravy\b/gi, 'con salsa gravy'],
    [/\bwith icing\b/gi, 'con glaseado'],
    [/\bor\b/gi, 'o'],
    [/\bwhole or sliced\b/gi, 'entero o en rebanadas'],
    [/\bhalves or slices\b/gi, 'mitades o rebanadas'],
    [/\bdrained solids\b/gi, 'solidos escurridos'],
    [/\bdry mix\b/gi, 'mezcla seca'],
    [/\bdry\b/gi, 'seco'],
    [/\bprepared\b/gi, 'preparado'],
    [/\bcooked\b/gi, 'cocido'],
    [/\braw\b/gi, 'crudo'],
    [/\bdrained\b/gi, 'escurrido'],
    [/\bcanned\b/gi, 'enlatado'],
    [/\bcondensed\b/gi, 'condensado'],
    [/\bconcentrate\b/gi, 'concentrado'],
    [/\buncooked\b/gi, 'sin cocinar'],
    [/\bblanched\b/gi, 'escaldado'],
    [/\bgrilled\b/gi, 'a la parrilla'],
    [/\bcubed\b/gi, 'en cubos'],
    [/\bcubes\b/gi, 'cubos'],
    [/\bdiced\b/gi, 'en cubitos'],
    [/\bcrushed\b/gi, 'triturado'],
    [/\bchopped\b/gi, 'picado'],
    [/\bsliced\b/gi, 'en rebanadas'],
    [/\bshredded\b/gi, 'rallado'],
    [/\bgrated\b/gi, 'rallado'],
    [/\bground\b/gi, 'molido'],
    [/\bfresh\b/gi, 'fresco'],
    [/\bpowder\b/gi, 'polvo'],
    [/\bsections\b/gi, 'gajos'],
    [/\bshelled\b/gi, 'pelado'],
    [/\bhalves\b/gi, 'mitades'],
    [/\bwhole\b/gi, 'entero'],
    [/\bfrozen\b/gi, 'congelado'],
    [/\bbrewed\b/gi, 'preparado'],
    [/\bpopped\b/gi, 'reventado'],
    [/\bpitted\b/gi, 'sin hueso'],
    [/\bstewed\b/gi, 'guisado'],
    [/\bdried\b/gi, 'seco'],
    [/\bmedium\b/gi, 'mediano'],
    [/\border\b/gi, 'porcion'],
    [/\broot\b/gi, 'raiz'],
    [/\bkernel\b/gi, 'grano'],
    [/\bkernels\b/gi, 'granos'],
    [/\bgrain\b/gi, 'grano'],
    [/\bgrapes\b/gi, 'uvas'],
    [/\bmushrooms\b/gi, 'hongos'],
    [/\bpods\b/gi, 'vainas'],
    [/\bprunes\b/gi, 'ciruelas pasas'],
    [/\bdia\b/gi, 'diametro'],
    [/\bdiameter\b/gi, 'diametro'],
    [/\bfl oz\b/gi, 'onza liquida'],
    [/\bml\b/gi, 'mL'],
    [/\btablespoons?\b/gi, 'cucharada'],
    [/\btbsp\b/gi, 'cda'],
    [/\bteaspoons?\b/gi, 'cucharadita'],
    [/\btsp\b/gi, 'cdta'],
    [/\bportion\b/gi, 'porcion'],
    [/\bserving\b/gi, 'porcion'],
    [/\bbowl\b/gi, 'tazon'],
    [/\bcups?\b/gi, 'taza'],
    [/\bslices?\b/gi, 'rebanada'],
    [/\bpieces?\b/gi, 'pieza'],
    [/\bcookies?\b/gi, 'galleta'],
    [/\bcrackers?\b/gi, 'cracker'],
    [/\bmuffins?\b/gi, 'muffin'],
    [/\bdoughnuts?\b/gi, 'dona'],
    [/\bbiscuits?\b/gi, 'bizcocho'],
    [/\bbars?\b/gi, 'barra'],
    [/\bjars?\b/gi, 'frasco'],
    [/\bglasses\b/gi, 'vaso'],
    [/\bglass\b/gi, 'vaso'],
    [/\bcontainers?\b/gi, 'envase'],
    [/\bcans?\b/gi, 'lata'],
    [/\bpackages?\b/gi, 'paquete'],
    [/\bpackets?\b/gi, 'sobre'],
    [/\bpacks?\b/gi, 'paquete'],
    [/\bscoops?\b/gi, 'scoop'],
    [/\bfrankfurters?\b/gi, 'salchicha tipo frankfurt'],
    [/\bdrumsticks?\b/gi, 'muslo de pollo'],
    [/\blinks?\b/gi, 'pieza'],
    [/\bwafers?\b/gi, 'oblea'],
    [/\bbrownies?\b/gi, 'brownie'],
    [/\bbagels?\b/gi, 'bagel'],
    [/\bburritos?\b/gi, 'burrito'],
    [/\bpupusas?\b/gi, 'pupusa'],
    [/\bsalads?\b/gi, 'ensalada'],
    [/\bwaffles?\b/gi, 'waffle'],
    [/\bcakes?\b/gi, 'pastel'],
    [/\bpatty\b/gi, 'torta'],
    [/\bpears?\b/gi, 'pera'],
    [/\btortillas?\b/gi, 'tortilla'],
    [/\bblocks?\b/gi, 'bloque'],
    [/\bsandwich cracker\b/gi, 'cracker sandwich'],
    [/\bsandwich(?:es)?\b/gi, 'sandwich'],
    [/\brolls?\b/gi, 'rollo'],
    [/\bbuns?\b/gi, 'bollo'],
    [/\bbottles?\b/gi, 'botella'],
    [/\bboxes\b/gi, 'caja'],
    [/\bbox\b/gi, 'caja'],
    [/\bbags?\b/gi, 'bolsa'],
    [/\bskewers?\b/gi, 'brocheta'],
    [/\bsheets?\b/gi, 'lamina'],
    [/\boz\b/gi, 'onza'],
  ],
};

const TERM_REPLACEMENTS: Record<string, Array<[RegExp, string]>> = {
  'zh-CN': [
    [/\bwith milk\b/gi, '加奶'],
    [/\bwith gravy\b/gi, '配肉汁'],
    [/\bwith icing\b/gi, '配糖霜'],
    [/\babout\b/gi, '约'],
    [/\bof\b/gi, '的'],
    [/\bwith\b/gi, '配'],
    [/\blarge\b/gi, '大'],
    [/\bsmall\b/gi, '小'],
    [/\bround\b/gi, '圆形'],
    [/\blayer\b/gi, '夹层'],
    [/\bthick\b/gi, '厚'],
    [/\blong\b/gi, '长'],
    [/\bbun\b/gi, '面包卷'],
    [/\btaco shell\b/gi, '塔可壳'],
    [/\bshell\b/gi, '壳'],
    [/\bsticks?\b/gi, '条'],
    [/\bsausage\b/gi, '香肠'],
    [/\bhotcakes\b/gi, '热香饼'],
    [/\bmargarine\b/gi, '人造黄油'],
    [/\bsyrup\b/gi, '糖浆'],
    [/\bcrust\b/gi, '饼皮'],
    [/\bsquare\b/gi, '方块'],
    [/\bcube\b/gi, '方块'],
    [/\bcake\b/gi, '蛋糕'],
    [/\bpie\b/gi, '派'],
    [/\bpizza\b/gi, '披萨'],
    [/\bbagels?\b/gi, '贝果'],
    [/\bavocados?\b/gi, '牛油果'],
    [/\bcroissants?\b/gi, '牛角包'],
    [/\bartichokes?\b/gi, '洋蓟'],
    [/\bclementines?\b/gi, '小柑橘'],
    [/\bnectarines?\b/gi, '油桃'],
    [/\bapricots?\b/gi, '杏'],
    [/\bguavas?\b/gi, '番石榴'],
    [/\bkiwifruit\b/gi, '猕猴桃'],
    [/\blemons?\b/gi, '柠檬'],
    [/\blimes?\b/gi, '青柠'],
    [/\bpancakes?\b/gi, '煎饼'],
    [/\bpastries\b/gi, '酥点'],
    [/\bpastry\b/gi, '酥点'],
    [/\bpeppers?\b/gi, '辣椒'],
    [/\bplantains?\b/gi, '大蕉'],
    [/\bplums?\b/gi, '李子'],
    [/\bquinces?\b/gi, '榅桲'],
    [/\bshallots?\b/gi, '红葱头'],
    [/\bears?\b/gi, '穗'],
    [/\bfruit\b/gi, '水果'],
    [/\bskin\b/gi, '皮'],
    [/\bfigs?\b/gi, '无花果'],
    [/\bpeaches?\b/gi, '桃子'],
    [/\btangerines?\b/gi, '橘子'],
    [/\bpretzels?\b/gi, '椒盐卷饼'],
    [/\btomatillos?\b/gi, '墨西哥酸浆'],
    [/\bstrawberries\b/gi, '草莓'],
    [/\bstrawberry\b/gi, '草莓'],
  ],
  'zh-TW': [
    [/\bwith milk\b/gi, '加奶'],
    [/\bwith gravy\b/gi, '配肉汁'],
    [/\bwith icing\b/gi, '配糖霜'],
    [/\babout\b/gi, '約'],
    [/\bof\b/gi, '的'],
    [/\bwith\b/gi, '配'],
    [/\blarge\b/gi, '大'],
    [/\bsmall\b/gi, '小'],
    [/\bround\b/gi, '圓形'],
    [/\blayer\b/gi, '夾層'],
    [/\bthick\b/gi, '厚'],
    [/\blong\b/gi, '長'],
    [/\bbun\b/gi, '麵包卷'],
    [/\btaco shell\b/gi, '塔可殼'],
    [/\bshell\b/gi, '殼'],
    [/\bsticks?\b/gi, '條'],
    [/\bsausage\b/gi, '香腸'],
    [/\bhotcakes\b/gi, '熱香餅'],
    [/\bmargarine\b/gi, '人造奶油'],
    [/\bsyrup\b/gi, '糖漿'],
    [/\bcrust\b/gi, '餅皮'],
    [/\bsquare\b/gi, '方塊'],
    [/\bcube\b/gi, '方塊'],
    [/\bcake\b/gi, '蛋糕'],
    [/\bpie\b/gi, '派'],
    [/\bpizza\b/gi, '披薩'],
    [/\bbagels?\b/gi, '貝果'],
    [/\bavocados?\b/gi, '酪梨'],
    [/\bcroissants?\b/gi, '可頌'],
    [/\bartichokes?\b/gi, '朝鮮薊'],
    [/\bclementines?\b/gi, '小柑橘'],
    [/\bnectarines?\b/gi, '油桃'],
    [/\bapricots?\b/gi, '杏'],
    [/\bguavas?\b/gi, '番石榴'],
    [/\bkiwifruit\b/gi, '奇異果'],
    [/\blemons?\b/gi, '檸檬'],
    [/\blimes?\b/gi, '青檸'],
    [/\bpancakes?\b/gi, '煎餅'],
    [/\bpastries\b/gi, '酥點'],
    [/\bpastry\b/gi, '酥點'],
    [/\bpeppers?\b/gi, '辣椒'],
    [/\bplantains?\b/gi, '大蕉'],
    [/\bplums?\b/gi, '李子'],
    [/\bquinces?\b/gi, '榅桲'],
    [/\bshallots?\b/gi, '紅蔥頭'],
    [/\bears?\b/gi, '穗'],
    [/\bfruit\b/gi, '水果'],
    [/\bskin\b/gi, '皮'],
    [/\bfigs?\b/gi, '無花果'],
    [/\bpeaches?\b/gi, '桃子'],
    [/\btangerines?\b/gi, '橘子'],
    [/\bpretzels?\b/gi, '椒鹽卷餅'],
    [/\btomatillos?\b/gi, '墨西哥酸漿'],
    [/\bstrawberries\b/gi, '草莓'],
    [/\bstrawberry\b/gi, '草莓'],
  ],
  'ja-JP': [
    [/\bhotcakes\s+with\s+margarine\s*&\s*syrup\b/gi, 'ホットケーキ マーガリンとシロップ付き'],
    [/\bwith margarine\s*&\s*syrup\b/gi, 'マーガリンとシロップ付き'],
    [/\bwith skin\b/gi, '皮付き'],
    [/\bwith milk\b/gi, '牛乳入り'],
    [/\bwith gravy\b/gi, 'グレービー付き'],
    [/\bwith icing\b/gi, 'アイシング付き'],
    [/\babout\b/gi, '約'],
    [/\bof\b/gi, 'の'],
    [/\bwith\b/gi, '添え'],
    [/\blarge\b/gi, '大サイズ'],
    [/\bsmall\b/gi, '小サイズ'],
    [/\bround\b/gi, '丸型'],
    [/\blayer\b/gi, 'レイヤー'],
    [/\bthick\b/gi, '厚切り'],
    [/\blong\b/gi, '長さ'],
    [/\bbun\b/gi, 'パン'],
    [/\btaco shell\b/gi, 'タコシェル'],
    [/\bshell\b/gi, 'シェル'],
    [/\bsticks?\b/gi, '本'],
    [/\bsausage\b/gi, 'ソーセージ'],
    [/\bhotcakes\b/gi, 'ホットケーキ'],
    [/\bmargarine\b/gi, 'マーガリン'],
    [/\bsyrup\b/gi, 'シロップ'],
    [/\bcrust\b/gi, 'クラスト'],
    [/\bsquare\b/gi, '角'],
    [/\bcube\b/gi, '角切り'],
    [/\bcake\b/gi, 'ケーキ'],
    [/\bpie\b/gi, 'パイ'],
    [/\bpizza\b/gi, 'ピザ'],
    [/\bbagels?\b/gi, 'ベーグル'],
    [/\bavocados?\b/gi, 'アボカド'],
    [/\bcroissants?\b/gi, 'クロワッサン'],
    [/\bartichokes?\b/gi, 'アーティチョーク'],
    [/\bclementines?\b/gi, 'クレメンタイン'],
    [/\bnectarines?\b/gi, 'ネクタリン'],
    [/\bapricots?\b/gi, 'アプリコット'],
    [/\bguavas?\b/gi, 'グアバ'],
    [/\bgrapefruit\b/gi, 'グレープフルーツ'],
    [/\bkiwifruit\b/gi, 'キウイフルーツ'],
    [/\blemons?\b/gi, 'レモン'],
    [/\blimes?\b/gi, 'ライム'],
    [/\bpancakes?\b/gi, 'パンケーキ'],
    [/\bpastries\b/gi, 'ペストリー'],
    [/\bpastry\b/gi, 'ペストリー'],
    [/\bpeppers?\b/gi, 'ペッパー'],
    [/\bplantains?\b/gi, 'プランテン'],
    [/\bplums?\b/gi, 'プラム'],
    [/\bquinces?\b/gi, 'マルメロ'],
    [/\bshallots?\b/gi, 'エシャロット'],
    [/\bears?\b/gi, '本'],
    [/\bfruit\b/gi, '果実'],
    [/\bskin\b/gi, '皮'],
    [/\bfigs?\b/gi, 'いちじく'],
    [/\bpeach(?:es)?\b/gi, '桃'],
    [/\btangerines?\b/gi, 'みかん'],
    [/\bpretzels?\b/gi, 'プレッツェル'],
    [/\bsoft\b/gi, 'ソフト'],
    [/\btomatillos?\b/gi, 'トマティーヨ'],
    [/\bstrawberries\b/gi, 'いちご'],
    [/\bstrawberry\b/gi, 'いちご'],
  ],
  'ko-KR': [
    [/\bhotcakes\s+with\s+margarine\s*&\s*syrup\b/gi, '핫케이크 마가린과 시럽 포함'],
    [/\bwith margarine\s*&\s*syrup\b/gi, '마가린과 시럽 포함'],
    [/\bwith skin\b/gi, '껍질 포함'],
    [/\bwith milk\b/gi, '우유 포함'],
    [/\bwith gravy\b/gi, '그레이비 포함'],
    [/\bwith icing\b/gi, '아이싱 포함'],
    [/\babout\b/gi, '약'],
    [/\bof\b/gi, '의'],
    [/\bwith\b/gi, '함께'],
    [/\blarge\b/gi, '큰'],
    [/\bsmall\b/gi, '작은'],
    [/\bround\b/gi, '원형'],
    [/\blayer\b/gi, '레이어'],
    [/\bthick\b/gi, '두께'],
    [/\blong\b/gi, '길이'],
    [/\bbun\b/gi, '번'],
    [/\btaco shell\b/gi, '타코 셸'],
    [/\bshell\b/gi, '셸'],
    [/\bsticks?\b/gi, '스틱'],
    [/\bsausage\b/gi, '소시지'],
    [/\bhotcakes\b/gi, '핫케이크'],
    [/\bmargarine\b/gi, '마가린'],
    [/\bsyrup\b/gi, '시럽'],
    [/\bcrust\b/gi, '크러스트'],
    [/\bsquare\b/gi, '정사각형'],
    [/\bcube\b/gi, '정육면체'],
    [/\bcake\b/gi, '케이크'],
    [/\bpie\b/gi, '파이'],
    [/\bpizza\b/gi, '피자'],
    [/\bbagels?\b/gi, '베이글'],
    [/\bavocados?\b/gi, '아보카도'],
    [/\bcroissants?\b/gi, '크루아상'],
    [/\bartichokes?\b/gi, '아티초크'],
    [/\bclementines?\b/gi, '클레멘타인'],
    [/\bnectarines?\b/gi, '넥타린'],
    [/\bapricots?\b/gi, '살구'],
    [/\bguavas?\b/gi, '구아바'],
    [/\bgrapefruit\b/gi, '자몽'],
    [/\bkiwifruit\b/gi, '키위'],
    [/\blemons?\b/gi, '레몬'],
    [/\blimes?\b/gi, '라임'],
    [/\bpancakes?\b/gi, '팬케이크'],
    [/\bpastries\b/gi, '페이스트리'],
    [/\bpastry\b/gi, '페이스트리'],
    [/\bpeppers?\b/gi, '고추'],
    [/\bplantains?\b/gi, '플랜테인'],
    [/\bplums?\b/gi, '자두'],
    [/\bquinces?\b/gi, '마르멜로'],
    [/\bshallots?\b/gi, '샬롯'],
    [/\bears?\b/gi, '개'],
    [/\bfruit\b/gi, '과일'],
    [/\bskin\b/gi, '껍질'],
    [/\bfigs?\b/gi, '무화과'],
    [/\bpeach(?:es)?\b/gi, '복숭아'],
    [/\btangerines?\b/gi, '귤'],
    [/\bpretzels?\b/gi, '프레첼'],
    [/\bsoft\b/gi, '소프트'],
    [/\btomatillos?\b/gi, '토마티요'],
    [/\bstrawberries\b/gi, '딸기'],
    [/\bstrawberry\b/gi, '딸기'],
  ],
  'es-ES': [
    [/\bwith milk\b/gi, 'con leche'],
    [/\bwith gravy\b/gi, 'con salsa gravy'],
    [/\bwith icing\b/gi, 'con glaseado'],
    [/\babout\b/gi, 'aprox.'],
    [/\bof\b/gi, 'de'],
    [/\bwith\b/gi, 'con'],
    [/\blarge\b/gi, 'grande'],
    [/\bsmall\b/gi, 'pequeno'],
    [/\bround\b/gi, 'redondo'],
    [/\blayer\b/gi, 'de capas'],
    [/\bthick\b/gi, 'grueso'],
    [/\blong\b/gi, 'largo'],
    [/\bbun\b/gi, 'bollo'],
    [/\btaco shell\b/gi, 'taco shell'],
    [/\bshell\b/gi, 'concha'],
    [/\bsticks?\b/gi, 'palitos'],
    [/\bsausage\b/gi, 'salchicha'],
    [/\bhotcakes\b/gi, 'hotcakes'],
    [/\bmargarine\b/gi, 'margarina'],
    [/\bsyrup\b/gi, 'jarabe'],
    [/\bcrust\b/gi, 'corteza'],
    [/\bsquare\b/gi, 'cuadrado'],
    [/\bcube\b/gi, 'cubo'],
    [/\bcake\b/gi, 'pastel'],
    [/\bpie\b/gi, 'pastel'],
    [/\bpizza\b/gi, 'pizza'],
    [/\bbagels?\b/gi, 'bagel'],
    [/\bavocados?\b/gi, 'aguacate'],
    [/\bcroissants?\b/gi, 'croissant'],
    [/\bartichokes?\b/gi, 'alcachofa'],
    [/\bclementines?\b/gi, 'clementina'],
    [/\bnectarines?\b/gi, 'nectarina'],
    [/\bapricots?\b/gi, 'albaricoque'],
    [/\bguavas?\b/gi, 'guayaba'],
    [/\bkiwifruit\b/gi, 'kiwi'],
    [/\blemons?\b/gi, 'limon'],
    [/\blimes?\b/gi, 'lima'],
    [/\bpancakes?\b/gi, 'panqueque'],
    [/\bpastries\b/gi, 'pastelitos'],
    [/\bpastry\b/gi, 'pastelito'],
    [/\bpeppers?\b/gi, 'pimiento'],
    [/\bplantains?\b/gi, 'platano macho'],
    [/\bplums?\b/gi, 'ciruela'],
    [/\bquinces?\b/gi, 'membrillo'],
    [/\bshallots?\b/gi, 'chalota'],
    [/\bears?\b/gi, 'mazorca'],
    [/\bfruit\b/gi, 'fruta'],
    [/\bskin\b/gi, 'piel'],
    [/\bfigs?\b/gi, 'higo'],
    [/\bpeaches?\b/gi, 'durazno'],
    [/\btangerines?\b/gi, 'mandarina'],
    [/\bpretzels?\b/gi, 'pretzel'],
    [/\btomatillos?\b/gi, 'tomatillo'],
    [/\bstrawberries\b/gi, 'fresas'],
    [/\bstrawberry\b/gi, 'fresa'],
  ],
};

function localizeInch(value: string, locale: string): string {
  switch (locale) {
    case 'zh-CN':
      return `${value}英寸`;
    case 'zh-TW':
      return `${value}吋`;
    case 'ja-JP':
      return `${value}インチ`;
    case 'ko-KR':
      return `${value}인치`;
    case 'es-ES':
      return /^1(?:\.0+)?$/.test(value) ? `${value} pulgada` : `${value} pulgadas`;
    default:
      return `${value}-inch`;
  }
}

function localizeFractionOf(
  fraction: string,
  size: string,
  item: FractionItem,
  locale: string,
  modifier?: string,
): string {
  const localizedSize = localizeInch(size, locale);

  const localizedItem = (() => {
    switch (locale) {
      case 'zh-CN':
        if (item === 'cake' && modifier === 'round') return '圆形蛋糕';
        if (item === 'cake' && modifier === 'layer') return '夹层蛋糕';
        return item === 'pie' ? '派' : item === 'pizza' ? '披萨' : item === 'cake' ? '蛋糕' : '饼皮';
      case 'zh-TW':
        if (item === 'cake' && modifier === 'round') return '圓形蛋糕';
        if (item === 'cake' && modifier === 'layer') return '夾層蛋糕';
        return item === 'pie' ? '派' : item === 'pizza' ? '披薩' : item === 'cake' ? '蛋糕' : '餅皮';
      case 'ja-JP':
        if (item === 'cake' && modifier === 'round') return '丸型ケーキ';
        if (item === 'cake' && modifier === 'layer') return 'レイヤーケーキ';
        return item === 'pie' ? 'パイ' : item === 'pizza' ? 'ピザ' : item === 'cake' ? 'ケーキ' : 'クラスト';
      case 'ko-KR':
        if (item === 'cake' && modifier === 'round') return '원형 케이크';
        if (item === 'cake' && modifier === 'layer') return '레이어 케이크';
        return item === 'pie' ? '파이' : item === 'pizza' ? '피자' : item === 'cake' ? '케이크' : '크러스트';
      case 'es-ES':
        if (item === 'cake' && modifier === 'round') return 'pastel redondo';
        if (item === 'cake' && modifier === 'layer') return 'pastel de capas';
        return item === 'pie' ? 'pastel' : item === 'pizza' ? 'pizza' : item === 'cake' ? 'pastel' : 'corteza';
      default:
        return item;
    }
  })();

  switch (locale) {
    case 'zh-CN':
      return `${localizedSize}${localizedItem}的${fraction}`;
    case 'zh-TW':
      return `${localizedSize}${localizedItem}的${fraction}`;
    case 'ja-JP':
      return `${localizedSize}${localizedItem}の${fraction}`;
    case 'ko-KR':
      return `${localizedSize} ${localizedItem}의 ${fraction}`;
    case 'es-ES':
      return `${fraction} de ${localizedItem} de ${localizedSize}`;
    default:
      return `${fraction} of ${size}-inch ${item}`;
  }
}

function localizeSquare(value: string, locale: string): string {
  switch (locale) {
    case 'zh-CN':
      return `${value}英寸方块`;
    case 'zh-TW':
      return `${value}吋方塊`;
    case 'ja-JP':
      return `${value}インチ角`;
    case 'ko-KR':
      return `${value}인치 정사각형`;
    case 'es-ES':
      return `cuadrado de ${localizeInch(value, locale)}`;
    default:
      return `${value}-inch square`;
  }
}

function localizeDimension(value: string, kind: 'diameter' | 'long', locale: string): string {
  const localizedSize = localizeInch(value, locale);

  switch (locale) {
    case 'zh-CN':
      return `${localizedSize}${kind === 'diameter' ? '直径' : '长'}`;
    case 'zh-TW':
      return `${localizedSize}${kind === 'diameter' ? '直徑' : '長'}`;
    case 'ja-JP':
      return `${localizedSize}${kind === 'diameter' ? '直径' : '長さ'}`;
    case 'ko-KR':
      return `${localizedSize} ${kind === 'diameter' ? '지름' : '길이'}`;
    case 'es-ES':
      return `${kind === 'diameter' ? 'diametro' : 'largo'} de ${localizedSize}`;
    default:
      return `${localizedSize} ${kind}`;
  }
}

function localizeSizeFirstPiece(value: string, locale: string): string {
  const localizedSize = localizeInch(value, locale);

  switch (locale) {
    case 'zh-CN':
      return `${localizedSize}块`;
    case 'zh-TW':
      return `${localizedSize}塊`;
    case 'ja-JP':
      return `${localizedSize}片`;
    case 'ko-KR':
      return `${localizedSize} 조각`;
    case 'es-ES':
      return `pieza de ${localizedSize}`;
    default:
      return `${value}-inch piece`;
  }
}

function localizeMeasurementPhrases(label: string, locale: string): string {
  let out = label;
  const fractionOfSizeItemRe = new RegExp(
    `(${INCH_VALUE_RE.replace('(?:\\.\\d+)?', '(?:\\.\\d+)?')})\\s*of\\s*(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+(?:(round|layer)\\s+)?(pie|pizza|cake|crust)\\b`,
    'gi',
  );
  const inchCubeRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+cube\\b`, 'gi');
  const inchSquareRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+square\\b`, 'gi');
  const inchDiameterRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+diameter\\b`, 'gi');
  const inchLongRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+long\\b`, 'gi');
  const inchPieceRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")\\s+piece\\b`, 'gi');
  const inchValueOnlyRe = new RegExp(`(${INCH_VALUE_RE})\\s*(?:-\\s*inch|\\s*inch|")`, 'gi');

  out = out.replace(
    fractionOfSizeItemRe,
    (_match, fraction: string, size: string, modifier: string | undefined, item: FractionItem) =>
      localizeFractionOf(fraction, size, item, locale, modifier?.toLowerCase()),
  );

  out = out.replace(inchCubeRe, (_match, size: string) => {
    switch (locale) {
      case 'zh-CN':
        return `${localizeInch(size, locale)}方块`;
      case 'zh-TW':
        return `${localizeInch(size, locale)}方塊`;
      case 'ja-JP':
        return `${localizeInch(size, locale)}角切り`;
      case 'ko-KR':
        return `${localizeInch(size, locale)} 정육면체`;
      case 'es-ES':
        return `cubo de ${localizeInch(size, locale)}`;
      default:
        return `${size}-inch cube`;
    }
  });

  out = out.replace(inchSquareRe, (_match, size: string) => localizeSquare(size, locale));

  out = out.replace(inchDiameterRe, (_match, size: string) => localizeDimension(size, 'diameter', locale));

  out = out.replace(inchLongRe, (_match, size: string) => localizeDimension(size, 'long', locale));

  out = out.replace(inchPieceRe, (_match, size: string) => localizeSizeFirstPiece(size, locale));

  out = out.replace(inchValueOnlyRe, (_match, size: string) => localizeInch(size, locale));

  out = out.replace(/\s*&\s*/g, locale === 'es-ES' ? ' y ' : locale === 'ja-JP' ? ' と ' : locale === 'ko-KR' ? ' 및 ' : '和');

  out = out.replace(/\((\d+(?:\.\d+)?)\s*mL\)/gi, (_match, value: string) => {
    switch (locale) {
      case 'zh-CN':
      case 'zh-TW':
        return `(${value}毫升)`;
      case 'ja-JP':
      case 'ko-KR':
        return `(${value}mL)`;
      case 'es-ES':
        return `(${value} mL)`;
      default:
        return `(${value} mL)`;
    }
  });

  return out;
}

function parseLocales(): Set<string> {
  const raw = process.env.LOCALES?.trim();
  if (!raw) return new Set(DEFAULT_LOCALES);

  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function normalizeSourceText(input: string | null | undefined): string {
  return (input || '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChineseForLocale(input: string, locale: string, grams: number): string {
  const source = normalizeSourceText(input);
  const perMatch = source.match(/^每\s*(\d+(?:\.\d+)?)\s*(?:g|克)$/i);
  if (perMatch) {
    return `每${perMatch[1]}g`;
  }

  const onlyGrams = source.match(/^(\d+(?:\.\d+)?)\s*(?:g|克)$/i);
  if (onlyGrams) {
    return `${onlyGrams[1]}g`;
  }

  let text = source.replace(/克/g, 'g');
  if (locale === 'zh-TW') {
    text = text.replace(/约/g, '約').replace(/个/g, '個').replace(/汤匙/g, '湯匙');
  }

  if (!text) return `${grams}g`;
  return text;
}

function pluralizeEnglish(label: string, count: string): string {
  if (count === '1') return label;
  if (label === 'piece') return 'pieces';
  if (label === 'portion') return 'portions';
  if (label === 'bowl') return 'bowls';
  if (label === 'slice') return 'slices';
  if (label === 'cup') return 'cups';
  if (label === 'can') return 'cans';
  if (label === 'pack') return 'packs';
  if (label === 'box') return 'boxes';
  if (label === 'bottle') return 'bottles';
  if (label === 'bag') return 'bags';
  if (label === 'skewer') return 'skewers';
  if (label === 'sheet') return 'sheets';
  if (label.endsWith('s')) return label;
  return `${label}s`;
}

function chineseToEnglish(source: string, grams: number): string {
  const normalized = normalizeSourceText(source);

  const perMatch = normalized.match(/^每\s*(\d+(?:\.\d+)?)\s*(?:g|克)$/i);
  if (perMatch) {
    return `per ${perMatch[1]}g`;
  }

  const portionMatch = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(汤匙|茶匙|份|碗|个|片|杯|勺|包|块|条|只|枚|根|串|张|盒|罐|瓶|袋)(?:左右|约|約)?\s*(\d+(?:\.\d+)?)\s*(?:g|克)$/i,
  );
  if (portionMatch) {
    const [, count, measure, gramsText] = portionMatch;
    const label = ZH_MEASURE_TO_EN[measure] || 'portion';
    return `${count} ${pluralizeEnglish(label, count)} (~${gramsText}g)`;
  }

  const onlyGrams = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:g|克)$/i);
  if (onlyGrams) {
    return `${onlyGrams[1]}g`;
  }

  return `${grams}g`;
}

function toEnglishCanonical(
  standardServingDesc: string | null,
  standardServingG: number,
): { value: string; sourceKind: SourceKind } {
  const source = normalizeSourceText(standardServingDesc);
  const fallback = `${standardServingG}g`;

  if (!source) {
    return { value: fallback, sourceKind: 'grams-fallback' };
  }

  if (CJK_RE.test(source)) {
    return {
      value: chineseToEnglish(source, standardServingG),
      sourceKind: 'cjk-template',
    };
  }

  return { value: source, sourceKind: 'english-direct' };
}

function localizePerGram(grams: string, locale: string): string {
  switch (locale) {
    case 'zh-CN':
    case 'zh-TW':
      return `每${grams}g`;
    case 'ja-JP':
      return `${grams}gあたり`;
    case 'ko-KR':
      return `${grams}g당`;
    case 'es-ES':
      return `por ${grams}g`;
    default:
      return `per ${grams}g`;
  }
}

function applyLabelReplacements(label: string, locale: string): string {
  let localized = localizeMeasurementPhrases(label, locale);

  const termRules = TERM_REPLACEMENTS[locale];
  if (termRules?.length) {
    for (const [pattern, replacement] of termRules) {
      localized = localized.replace(pattern, replacement);
    }
  }

  const rules = LABEL_REPLACEMENTS[locale];
  if (!rules || !rules.length) {
    return localized.replace(/\s+/g, ' ').trim();
  }

  for (const [pattern, replacement] of rules) {
    localized = localized.replace(pattern, replacement);
  }

  if (locale === 'ja-JP') {
    localized = localized
      .replace(/\b([^\s()]+)\s+皮付き\b/g, '皮付き$1')
      .replace(/ホットケーキ\s+添え\s+マーガリン\s+と\s+シロップ/g, 'ホットケーキ マーガリンとシロップ付き')
      .replace(/\s+マーガリン\s+と\s+シロップ付き/g, ' マーガリンとシロップ付き');
  }

  if (locale === 'ko-KR') {
    localized = localized
      .replace(/\b([^\s()]+)\s+껍질 포함\b/g, '껍질 포함 $1')
      .replace(/핫케이크\s+함께\s+마가린\s+및\s+시럽/g, '핫케이크 마가린과 시럽 포함')
      .replace(/\s+마가린\s+및\s+시럽 포함/g, ' 마가린과 시럽 포함');
  }

  return localized.replace(/\s+/g, ' ').trim();
}

function polishLocalizedServingDesc(text: string, locale: string): string {
  let out = text;

  if (locale === 'ja-JP') {
    out = out
      .replace(/\(([^()]*?)(\d+(?:-\d+\/\d+|\/\d+|(?:\.\d+)?)インチ)\s+直径([^()]*)\)/g, '($1直径$2$3)')
      .replace(/(\d+(?:\.\d+)?)インチパイの(\d+\/\d+)\s+クラスト/g, '$1インチパイクラストの$2')
      .replace(/(\d+(?:\/\d+)?)果実\b/g, '$1個')
      .replace(/(\d+)枚パティ\s+グレービー付き/g, 'グレービー付きパティ$1枚')
      .replace(/(\d+)個ロール\s+アイシング付き/g, 'アイシング付きロール$1個')
      .replace(/(\d+)\s+ソーセージ\s+枚パティ/g, '$1枚ソーセージパティ');
  }

  if (locale === 'ko-KR') {
    out = out
      .replace(/\(([^()]*?)(\d+(?:-\d+\/\d+|\/\d+|(?:\.\d+)?)인치)\s+지름([^()]*)\)/g, '($1지름 $2$3)')
      .replace(/(\d+(?:\.\d+)?)인치\s+파이의\s+(\d+\/\d+)\s+크러스트/g, '$1인치 파이 크러스트 $2')
      .replace(/(\d+(?:\.\d+)?)인치\s+크러스트의\s+(\d+\/\d+)/g, '$1인치 크러스트 $2')
      .replace(/(\d+(?:\/\d+)?)\s+과일\b/g, '$1개')
      .replace(/(\d+)\s+장\s+패티\b/g, '패티 $1장')
      .replace(/(\d+)\s+장 패티\s+그레이비 포함/g, '그레이비 포함 패티 $1장')
      .replace(/(\d+)\s+개 롤\s+아이싱 포함/g, '아이싱 포함 롤 $1개')
      .replace(/(\d+)\s+소시지\s+장 패티/g, '소시지 패티 $1장');
  }

  if (locale === 'es-ES') {
    out = out
      .replace(/\b(\d+(?:\/\d+)?)\s+mediano\s+fruta\b/g, '$1 fruta mediana')
      .replace(/\b(\d+(?:\/\d+)?)\s+mediano\s+panqueque\b/g, '$1 panqueque mediano')
      .replace(/\b(\d+(?:\/\d+)?)\s+mediano\s+tortilla\b/g, '$1 tortilla mediana')
      .replace(/\b([2-9]\d*)\s+panqueque\b/g, '$1 panqueques')
      .replace(/\b([2-9]\d*)\s+panqueques\s+mediano\b/g, '$1 panqueques medianos')
      .replace(/\b([2-9]\d*)\s+panqueque\s+mediano\b/g, '$1 panqueques medianos')
      .replace(/\b(\d+\/\d+)\s+de\s+pastel\s+de\s+(\d+(?:\.\d+)?)\s+pulgadas\s+corteza\b/g, '$1 de corteza de $2 pulgadas');
  }

  return out.replace(/\s+/g, ' ').trim();
}

function formatQuantityLabel(
  amount: string,
  label: string,
  grams: string | null,
  locale: string,
): string {
  const localizedLabel = applyLabelReplacements(label, locale);

  if (locale === 'zh-CN' || locale === 'zh-TW') {
    const compactLabel = /[A-Za-z]/.test(localizedLabel)
      ? localizedLabel
      : localizedLabel.replace(/\s+/g, '');
    return grams
      ? `${amount}${compactLabel} (${grams}g)`
      : `${amount}${compactLabel}`;
  }

  if (locale === 'ja-JP') {
    return grams
      ? `${amount}${localizedLabel} (${grams}g)`
      : `${amount}${localizedLabel}`;
  }

  if (locale === 'ko-KR') {
    return grams
      ? `${amount} ${localizedLabel} (${grams}g)`
      : `${amount} ${localizedLabel}`;
  }

  if (locale === 'es-ES') {
    return grams
      ? `${amount} ${localizedLabel} (${grams}g)`
      : `${amount} ${localizedLabel}`;
  }

  return grams ? `${amount} ${label} (${grams}g)` : `${amount} ${label}`;
}

function localizeFromEnglishCanonical(canonical: string, locale: string): string {
  const source = normalizeSourceText(canonical);

  const perMatch = source.match(/^per\s+(\d+(?:\.\d+)?)g$/i);
  if (perMatch) {
    return localizePerGram(perMatch[1], locale);
  }

  const onlyGrams = source.match(/^(\d+(?:\.\d+)?)g$/i);
  if (onlyGrams) {
    return `${onlyGrams[1]}g`;
  }

  const gramsMatch = source.match(LAST_GRAMS_RE);
  const grams = gramsMatch?.[1] ?? null;
  const head = gramsMatch ? source.slice(0, gramsMatch.index).trim() : source;

  const amountMatch = head.match(AMOUNT_LABEL_RE);
  if (amountMatch) {
    const [, amount, label] = amountMatch;

    if (/^\d+\/\d+$/.test(amount) && /^of\b/i.test(label)) {
      const fullyLocalized = applyLabelReplacements(`${amount} ${label}`, locale);
      return polishLocalizedServingDesc(grams ? `${fullyLocalized} (${grams}g)` : fullyLocalized, locale);
    }

    if (new RegExp(`^${INCH_VALUE_RE}\\s*(?:-\\s*inch|\\s*inch|")\\b`, 'i').test(`${amount} ${label}`)) {
      const fullyLocalized = applyLabelReplacements(`${amount} ${label}`, locale);
      return polishLocalizedServingDesc(grams ? `${fullyLocalized} (${grams}g)` : fullyLocalized, locale);
    }

    return polishLocalizedServingDesc(formatQuantityLabel(amount, label, grams, locale), locale);
  }

  return polishLocalizedServingDesc(applyLabelReplacements(source, locale), locale);
}

function buildServingDesc(
  row: CandidateRow,
): { value: string; sourceKind: SourceKind; strategy: Strategy } {
  const source = normalizeSourceText(row.standardServingDesc);
  const locale = row.locale;

  if (source && CJK_RE.test(source) && (locale === 'zh-CN' || locale === 'zh-TW')) {
    return {
      value: normalizeChineseForLocale(source, locale, row.standardServingG),
      sourceKind: 'cjk-template',
      strategy: 'zh-direct',
    };
  }

  const canonical = toEnglishCanonical(row.standardServingDesc, row.standardServingG);

  if (locale === 'en-US' || locale === 'AU') {
    return {
      value: canonical.value,
      sourceKind: canonical.sourceKind,
      strategy:
        canonical.sourceKind === 'grams-fallback'
          ? 'grams-fallback'
          : 'english-direct',
    };
  }

  if (locale === 'zh-CN' || locale === 'zh-TW') {
    return {
      value: localizeFromEnglishCanonical(canonical.value, locale),
      sourceKind: canonical.sourceKind,
      strategy:
        canonical.sourceKind === 'grams-fallback'
          ? 'grams-fallback'
          : 'localized-from-english',
    };
  }

  return {
    value: localizeFromEnglishCanonical(canonical.value, locale),
    sourceKind: canonical.sourceKind,
    strategy:
      canonical.sourceKind === 'grams-fallback'
        ? 'grams-fallback'
        : 'localized-from-english',
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function printStatMap(title: string, stats: Record<string, number>) {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${value}`);
  }
}

async function main() {
  const targetLocales = parseLocales();

  console.log('\n=== food_translations.serving_desc 清洗脚本 ===');
  console.log(`模式: ${DRY_RUN ? '试运行（DRY RUN）' : '实际写库'}`);
  console.log(`locale: ${[...targetLocales].join(', ')}`);
  console.log(`batchSize: ${BATCH_SIZE}`);
  if (LIMIT > 0) console.log(`limit: ${LIMIT}`);
  console.log(`开始时间: ${new Date().toISOString()}\n`);

  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      ft.id AS "translationId",
      ft.food_id AS "foodId",
      ft.locale AS "locale",
      f.name AS "foodName",
      ft.serving_desc AS "currentServingDesc",
      pg.standard_serving_desc AS "standardServingDesc",
      pg.standard_serving_g AS "standardServingG"
    FROM food_translations ft
    JOIN food_portion_guides pg ON pg.food_id = ft.food_id
    JOIN foods f ON f.id = ft.food_id
    ORDER BY ft.locale, f.name
  `);

  const scopedRows = rows.filter((row) => targetLocales.has(row.locale));
  const limitedRows = LIMIT > 0 ? scopedRows.slice(0, LIMIT) : scopedRows;

  console.log(`候选翻译行: ${limitedRows.length}`);

  const changes: PlannedChange[] = [];
  const skippedTooLong: PlannedChange[] = [];
  const sourceStats: Record<string, number> = {};
  const strategyStats: Record<string, number> = {};
  const localeStats: Record<string, number> = {};

  for (const row of limitedRows) {
    const built = buildServingDesc(row);
    const nextServingDesc = normalizeSourceText(built.value);

    sourceStats[built.sourceKind] = (sourceStats[built.sourceKind] || 0) + 1;
    strategyStats[built.strategy] = (strategyStats[built.strategy] || 0) + 1;

    if (!nextServingDesc || nextServingDesc === normalizeSourceText(row.currentServingDesc)) {
      continue;
    }

    const planned: PlannedChange = {
      translationId: row.translationId,
      foodId: row.foodId,
      locale: row.locale,
      foodName: row.foodName,
      currentServingDesc: row.currentServingDesc,
      nextServingDesc,
      sourceKind: built.sourceKind,
      strategy: built.strategy,
    };

    if (nextServingDesc.length > 100) {
      skippedTooLong.push(planned);
      continue;
    }

    changes.push(planned);
    localeStats[row.locale] = (localeStats[row.locale] || 0) + 1;
  }

  console.log(`需要更新: ${changes.length}`);
  console.log(`超长跳过: ${skippedTooLong.length}`);

  printStatMap('来源类型分布：', sourceStats);
  printStatMap('生成策略分布：', strategyStats);
  printStatMap('按 locale 待更新：', localeStats);

  console.log(`\n变更样本（前 ${MAX_SAMPLES} 条）：`);
  for (const item of changes.slice(0, MAX_SAMPLES)) {
    console.log(
      `  [${item.locale}] ${item.foodName}: ${item.currentServingDesc ?? 'NULL'} -> ${item.nextServingDesc}`,
    );
  }
  if (changes.length > MAX_SAMPLES) {
    console.log(`  ... 以及另外 ${changes.length - MAX_SAMPLES} 条`);
  }

  if (skippedTooLong.length) {
    console.log(`\n超长样本（前 ${Math.min(10, skippedTooLong.length)} 条）：`);
    for (const item of skippedTooLong.slice(0, 10)) {
      console.log(
        `  [${item.locale}] ${item.foodName}: ${item.nextServingDesc.length} chars -> ${item.nextServingDesc}`,
      );
    }
  }

  if (DRY_RUN || changes.length === 0) {
    console.log('\n未写库，脚本结束。');
    return;
  }

  const groups = chunk(changes, BATCH_SIZE);
  let applied = 0;

  for (const group of groups) {
    await prisma.$transaction(
      group.map((item) =>
        prisma.foodTranslations.update({
          where: { id: item.translationId },
          data: { servingDesc: item.nextServingDesc },
        }),
      ),
    );
    applied += group.length;
    console.log(`已写入 ${applied}/${changes.length}`);
  }

  console.log('\n写库完成。');
}

main()
  .catch((error) => {
    console.error('\n脚本执行失败:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
