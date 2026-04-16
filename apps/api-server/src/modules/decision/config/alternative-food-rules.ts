/**
 * P1-2 / V1.9: 替代食物规则配置（i18n 增强）
 *
 * 按食物品类 + 用户目标提供替代建议，替代3条硬编码规则。
 * 每条规则包含触发条件和多语言替代建议列表。
 */

type LocaleKey = 'zh-CN' | 'en-US' | 'ja-JP';

export interface I18nAlternative {
  name: Record<LocaleKey, string>;
  reason: Record<LocaleKey, string>;
}

export interface AlternativeRule {
  /** 规则ID（调试用） */
  id: string;
  /** 触发条件 */
  trigger: {
    /** 匹配的食物品类（为空表示不限品类） */
    categories?: string[];
    /** 匹配的目标类型（为空表示所有目标） */
    goals?: string[];
    /** 热量阈值：食物热量 > 此值时触发 */
    minCalories?: number;
    /** 蛋白质阈值：总蛋白质 < 此值时触发 */
    maxProtein?: number;
    /** 碳水阈值：总碳水 > 此值时触发 */
    minCarbs?: number;
    /** 脂肪阈值：总脂肪 > 此值时触发 */
    minFat?: number;
  };
  /** 替代建议（多语言） */
  i18nAlternatives: I18nAlternative[];
  /** 替代建议（运行时解析后的单语言版本，由 resolveAlternatives 填充） */
  alternatives: Array<{ name: string; reason: string }>;
}

/**
 * V1.9: 根据 locale 解析 i18n 替代建议为单语言 { name, reason } 数组
 */
export function resolveAlternatives(
  rules: AlternativeRule[],
  locale: string = 'zh-CN',
): AlternativeRule[] {
  const loc = (
    locale === 'en-US' || locale === 'ja-JP' ? locale : 'zh-CN'
  ) as LocaleKey;
  return rules.map((rule) => ({
    ...rule,
    alternatives: rule.i18nAlternatives.map((alt) => ({
      name: alt.name[loc] || alt.name['zh-CN'],
      reason: alt.reason[loc] || alt.reason['zh-CN'],
    })),
  }));
}

// ==================== Helper: 简化 i18n 条目构建 ====================
function alt(
  zh: [string, string],
  en: [string, string],
  ja: [string, string],
): I18nAlternative {
  return {
    name: { 'zh-CN': zh[0], 'en-US': en[0], 'ja-JP': ja[0] },
    reason: { 'zh-CN': zh[1], 'en-US': en[1], 'ja-JP': ja[1] },
  };
}

/**
 * 按品类的替代规则
 */
export const CATEGORY_ALTERNATIVE_RULES: AlternativeRule[] = [
  // ===== 高热量/快餐/零食 =====
  {
    id: 'snack-high-cal',
    trigger: { categories: ['snack'], minCalories: 200 },
    i18nAlternatives: [
      alt(
        ['坚果（一小把）', '健康脂肪+蛋白质，饱腹感更强'],
        ['Nuts (small handful)', 'Healthy fats + protein, more satiating'],
        ['ナッツ（少量）', '健康的な脂肪+タンパク質、満腹感アップ'],
      ),
      alt(
        ['希腊酸奶', '高蛋白低糖，满足甜食渴望'],
        ['Greek yogurt', 'High protein, low sugar, satisfies sweet cravings'],
        ['ギリシャヨーグルト', '高タンパク低糖、甘いもの欲を満たす'],
      ),
    ],
    alternatives: [], // resolved at runtime
  },
  {
    id: 'beverage-sugar',
    trigger: { categories: ['beverage'], minCalories: 100 },
    i18nAlternatives: [
      alt(
        ['无糖绿茶', '零热量，提神解渴'],
        ['Unsweetened green tea', 'Zero calories, refreshing'],
        ['無糖緑茶', 'ゼロカロリー、リフレッシュ'],
      ),
      alt(
        ['黑咖啡', '几乎零热量，提升代谢'],
        ['Black coffee', 'Near-zero calories, boosts metabolism'],
        ['ブラックコーヒー', 'ほぼゼロカロリー、代謝アップ'],
      ),
      alt(
        ['气泡水+柠檬', '零糖替代甜饮料'],
        ['Sparkling water + lemon', 'Sugar-free alternative to sweet drinks'],
        ['炭酸水+レモン', 'ゼロシュガーで甘い飲み物の代替'],
      ),
    ],
    alternatives: [],
  },

  // ===== 主食/谷物 =====
  {
    id: 'grain-refined',
    trigger: { categories: ['grain'], minCarbs: 60 },
    i18nAlternatives: [
      alt(
        ['糙米', '低GI粗粮，升糖更平缓'],
        ['Brown rice', 'Low GI whole grain, gentler blood sugar rise'],
        ['玄米', '低GI全粒穀物、血糖の上昇が緩やか'],
      ),
      alt(
        ['燕麦', '高纤维，饱腹感更强'],
        ['Oats', 'High fiber, more filling'],
        ['オートミール', '高食物繊維、満腹感アップ'],
      ),
      alt(
        ['荞麦面', '低GI，适合控糖'],
        ['Buckwheat noodles', 'Low GI, good for blood sugar control'],
        ['そば', '低GI、血糖コントロールに適する'],
      ),
    ],
    alternatives: [],
  },
  {
    id: 'grain-high-cal',
    trigger: { categories: ['grain'], minCalories: 400 },
    i18nAlternatives: [
      alt(
        ['杂粮饭（半份）', '减少份量+增加纤维'],
        ['Mixed grain rice (half)', 'Reduce portion + more fiber'],
        ['雑穀米（半分）', '量を減らし+食物繊維アップ'],
      ),
      alt(
        ['红薯/紫薯', '低热量粗粮替代精制主食'],
        ['Sweet potato', 'Low-cal whole grain alternative to refined staples'],
        ['さつまいも', '低カロリーの全粒穀物で精製主食の代替'],
      ),
    ],
    alternatives: [],
  },

  // ===== 蛋白质 =====
  {
    id: 'protein-high-fat',
    trigger: { categories: ['protein'], minFat: 20 },
    i18nAlternatives: [
      alt(
        ['鸡胸肉', '高蛋白低脂，减脂首选'],
        ['Chicken breast', 'High protein, low fat — top choice for fat loss'],
        ['鶏むね肉', '高タンパク低脂肪、減量の第一選択'],
      ),
      alt(
        ['虾仁', '极低脂高蛋白'],
        ['Shrimp', 'Very low fat, high protein'],
        ['エビ', '超低脂肪・高タンパク'],
      ),
      alt(
        ['豆腐', '植物蛋白，低脂低卡'],
        ['Tofu', 'Plant protein, low fat & calories'],
        ['豆腐', '植物性タンパク質、低脂肪低カロリー'],
      ),
    ],
    alternatives: [],
  },

  // ===== 油脂类 =====
  {
    id: 'fat-excessive',
    trigger: { categories: ['fat'], minCalories: 200 },
    i18nAlternatives: [
      alt(
        ['牛油果（半个）', '健康不饱和脂肪'],
        ['Avocado (half)', 'Healthy unsaturated fats'],
        ['アボカド（半分）', '健康的な不飽和脂肪'],
      ),
      alt(
        ['橄榄油（少量）', '控制用量，优质脂肪'],
        ['Olive oil (small amount)', 'Portion control, quality fats'],
        ['オリーブオイル（少量）', '量をコントロール、良質な脂肪'],
      ),
    ],
    alternatives: [],
  },

  // ===== 复合菜/外卖 =====
  {
    id: 'composite-high-cal',
    trigger: { categories: ['composite'], minCalories: 500 },
    i18nAlternatives: [
      alt(
        ['蒸鱼+蔬菜', '少油烹饪，控制热量'],
        ['Steamed fish + vegetables', 'Low-oil cooking, fewer calories'],
        ['蒸し魚+野菜', '少油調理、カロリーコントロール'],
      ),
      alt(
        ['白灼虾+西兰花', '高蛋白低脂搭配'],
        ['Boiled shrimp + broccoli', 'High protein, low fat combo'],
        ['茹でエビ+ブロッコリー', '高タンパク低脂肪の組み合わせ'],
      ),
    ],
    alternatives: [],
  },
];

/**
 * 按目标 + 营养缺口的通用规则
 */
export const GOAL_ALTERNATIVE_RULES: AlternativeRule[] = [
  // 减脂: 蛋白质不足
  {
    id: 'fat-loss-low-protein',
    trigger: { goals: ['fat_loss'], maxProtein: 15, minCalories: 200 },
    i18nAlternatives: [
      alt(
        ['鸡胸肉沙拉', '低卡高蛋白，替代高热量食物'],
        [
          'Chicken breast salad',
          'Low-cal high-protein, replaces high-cal foods',
        ],
        ['鶏むね肉サラダ', '低カロリー高タンパク、高カロリー食品の代替'],
      ),
      alt(
        ['水煮蛋（2个）', '低成本补充优质蛋白质'],
        ['Boiled eggs (2)', 'Affordable quality protein'],
        ['ゆで卵（2個）', '手軽に良質なタンパク質を補給'],
      ),
      alt(
        ['无糖豆浆', '植物蛋白+低卡'],
        ['Unsweetened soy milk', 'Plant protein + low cal'],
        ['無糖豆乳', '植物性タンパク質+低カロリー'],
      ),
    ],
    alternatives: [],
  },
  // 减脂: 高热量
  {
    id: 'fat-loss-high-cal',
    trigger: { goals: ['fat_loss'], minCalories: 500 },
    i18nAlternatives: [
      alt(
        ['同类食物减半份量', '保持食物种类，减少总热量'],
        ['Same food, half portion', 'Keep variety, reduce total calories'],
        ['同じ食品の半分量', '種類を維持しつつ総カロリー削減'],
      ),
      alt(
        ['蔬菜汤+主食', '先喝汤增加饱腹感'],
        ['Veggie soup + staple', 'Soup first for satiety'],
        ['野菜スープ+主食', 'スープを先に飲んで満腹感アップ'],
      ),
    ],
    alternatives: [],
  },
  // 增肌: 蛋白质不足
  {
    id: 'muscle-gain-low-protein',
    trigger: { goals: ['muscle_gain'], maxProtein: 20, minCalories: 200 },
    i18nAlternatives: [
      alt(
        ['牛肉', '高蛋白+肌酸，增肌利器'],
        ['Beef', 'High protein + creatine, great for muscle gain'],
        ['牛肉', '高タンパク+クレアチン、筋肉増量に最適'],
      ),
      alt(
        ['鸡蛋（3个全蛋）', '完全蛋白+健康脂肪'],
        ['Eggs (3 whole)', 'Complete protein + healthy fats'],
        ['卵（全卵3個）', '完全タンパク+健康的な脂肪'],
      ),
      alt(
        ['金枪鱼', '极高蛋白，增肌首选'],
        ['Tuna', 'Very high protein, top pick for muscle gain'],
        ['マグロ', '超高タンパク、筋肉増量の第一選択'],
      ),
    ],
    alternatives: [],
  },
  // 增肌: 热量不足
  {
    id: 'muscle-gain-low-cal',
    trigger: { goals: ['muscle_gain'] },
    i18nAlternatives: [
      alt(
        ['全脂牛奶+香蕉', '快速补充热量和碳水'],
        ['Whole milk + banana', 'Quick calorie and carb boost'],
        ['全脂牛乳+バナナ', '素早くカロリーと炭水化物を補給'],
      ),
    ],
    alternatives: [],
  },
  // 健康: 碳水过高
  {
    id: 'health-high-carbs',
    trigger: { goals: ['health'], minCarbs: 80 },
    i18nAlternatives: [
      alt(
        ['混合蔬菜沙拉', '增加膳食纤维和微量元素'],
        ['Mixed veggie salad', 'More dietary fiber and micronutrients'],
        ['ミックスサラダ', '食物繊維と微量栄養素をプラス'],
      ),
      alt(
        ['全麦面包', '低GI替代精制碳水'],
        ['Whole wheat bread', 'Low GI alternative to refined carbs'],
        ['全粒粉パン', '低GIで精製炭水化物の代替'],
      ),
    ],
    alternatives: [],
  },
  // 通用: 蛋白质不足
  {
    id: 'general-low-protein',
    trigger: { maxProtein: 10, minCalories: 300 },
    i18nAlternatives: [
      alt(
        ['水煮蛋', '低成本补充优质蛋白质'],
        ['Boiled egg', 'Affordable quality protein'],
        ['ゆで卵', '手軽に良質なタンパク質を補給'],
      ),
      alt(
        ['鸡胸肉', '高蛋白低脂'],
        ['Chicken breast', 'High protein, low fat'],
        ['鶏むね肉', '高タンパク低脂肪'],
      ),
    ],
    alternatives: [],
  },
  // 通用: 碳水过高
  {
    id: 'general-high-carbs',
    trigger: { minCarbs: 100 },
    i18nAlternatives: [
      alt(
        ['糙米/燕麦', '用粗粮替代精制碳水'],
        ['Brown rice / oats', 'Replace refined carbs with whole grains'],
        ['玄米/オートミール', '精製炭水化物を全粒穀物に置換'],
      ),
    ],
    alternatives: [],
  },
];
