/**
 * 食物库种子数据
 * 数据参考中国食物成分表（China Food Composition Tables）
 * 运行方式: ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts
 *
 * 也可以通过 NestJS CLI 运行:
 * npx nestjs-command seed:foods
 */

export interface SeedFood {
  name: string;
  aliases?: string;
  category: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  standardServingG: number;
  standardServingDesc: string;
  searchWeight: number;
  tags?: string[];
  source?: 'official' | 'estimated' | 'ai';
  confidence?: number;
}

/**
 * 根据营养数据自动推导 tags
 */
function deriveTags(food: Omit<SeedFood, 'tags'>): string[] {
  const tags: string[] = [food.category];
  const p = food.proteinPer100g ?? 0;
  const f = food.fatPer100g ?? 0;
  const c = food.carbsPer100g ?? 0;
  const cal = food.caloriesPer100g;

  if (p >= 15) tags.push('高蛋白');
  if (cal <= 80) tags.push('低热量');
  if (cal <= 30) tags.push('超低热量');
  if (f >= 15) tags.push('高脂肪');
  if (c >= 30) tags.push('高碳水');
  if (f <= 3) tags.push('低脂');
  if (p >= 10 && (f >= 5 || c >= 15)) tags.push('高饱腹');
  if (['蔬菜', '水果', '豆制品'].includes(food.category)) tags.push('天然');
  if (p >= 5 && p <= 25 && f >= 2 && f <= 15 && c >= 5 && c <= 35) tags.push('均衡');
  if (food.category === '快餐') tags.push('外卖');

  return [...new Set(tags)];
}

export const SEED_FOODS: SeedFood[] = [
  // ===== 主食 (25) =====
  { name: '白米饭', category: '主食', caloriesPer100g: 116, proteinPer100g: 2.6, fatPer100g: 0.3, carbsPer100g: 25.6, standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 200 },
  { name: '糙米饭', category: '主食', caloriesPer100g: 111, proteinPer100g: 2.7, fatPer100g: 0.8, carbsPer100g: 23.0, standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 130 },
  { name: '馒头', category: '主食', caloriesPer100g: 223, proteinPer100g: 7.0, fatPer100g: 1.1, carbsPer100g: 47.0, standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 180 },
  { name: '花卷', category: '主食', caloriesPer100g: 211, proteinPer100g: 6.4, fatPer100g: 2.6, carbsPer100g: 42.0, standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 120 },
  { name: '包子（猪肉）', aliases: '肉包子,猪肉包', category: '主食', caloriesPer100g: 211, proteinPer100g: 9.5, fatPer100g: 7.1, carbsPer100g: 26.6, standardServingG: 90, standardServingDesc: '1个约90g', searchWeight: 170 },
  { name: '水饺（猪肉白菜）', aliases: '饺子,水饺', category: '主食', caloriesPer100g: 203, proteinPer100g: 8.5, fatPer100g: 8.0, carbsPer100g: 24.5, standardServingG: 200, standardServingDesc: '10个约200g', searchWeight: 175 },
  { name: '煎饺', aliases: '锅贴', category: '主食', caloriesPer100g: 252, proteinPer100g: 8.0, fatPer100g: 12.5, carbsPer100g: 26.0, standardServingG: 200, standardServingDesc: '10个约200g', searchWeight: 140 },
  { name: '煮面条', aliases: '面条,挂面,汤面', category: '主食', caloriesPer100g: 110, proteinPer100g: 3.6, fatPer100g: 0.6, carbsPer100g: 23.0, standardServingG: 250, standardServingDesc: '1碗约250g（熟）', searchWeight: 170 },
  { name: '米粉（煮熟）', aliases: '河粉,粉丝', category: '主食', caloriesPer100g: 109, proteinPer100g: 2.0, fatPer100g: 0.2, carbsPer100g: 25.0, standardServingG: 250, standardServingDesc: '1碗约250g', searchWeight: 140 },
  { name: '白粥', aliases: '大米粥,稀饭', category: '主食', caloriesPer100g: 46, proteinPer100g: 0.8, fatPer100g: 0.1, carbsPer100g: 10.1, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 160 },
  { name: '油条', category: '主食', caloriesPer100g: 386, proteinPer100g: 6.9, fatPer100g: 17.6, carbsPer100g: 50.1, standardServingG: 80, standardServingDesc: '1根约80g', searchWeight: 160 },
  { name: '烧饼', category: '主食', caloriesPer100g: 326, proteinPer100g: 8.3, fatPer100g: 8.4, carbsPer100g: 55.0, standardServingG: 70, standardServingDesc: '1个约70g', searchWeight: 130 },
  { name: '米线（煮熟）', aliases: '过桥米线', category: '主食', caloriesPer100g: 92, proteinPer100g: 1.5, fatPer100g: 0.1, carbsPer100g: 21.0, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 145 },
  { name: '螺蛳粉', category: '主食', caloriesPer100g: 126, proteinPer100g: 4.0, fatPer100g: 3.5, carbsPer100g: 20.0, standardServingG: 400, standardServingDesc: '1份约400g（含汤）', searchWeight: 155 },
  { name: '炒饭（蛋炒饭）', aliases: '蛋炒饭', category: '主食', caloriesPer100g: 178, proteinPer100g: 5.2, fatPer100g: 6.5, carbsPer100g: 24.8, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 190 },
  { name: '拉面', aliases: '兰州拉面', category: '主食', caloriesPer100g: 115, proteinPer100g: 4.0, fatPer100g: 1.5, carbsPer100g: 22.0, standardServingG: 400, standardServingDesc: '1碗约400g（含汤）', searchWeight: 160 },
  { name: '煎饼果子', category: '主食', caloriesPer100g: 225, proteinPer100g: 7.0, fatPer100g: 10.0, carbsPer100g: 28.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '手抓饼', category: '主食', caloriesPer100g: 280, proteinPer100g: 5.5, fatPer100g: 12.0, carbsPer100g: 38.0, standardServingG: 120, standardServingDesc: '1个约120g', searchWeight: 140 },
  { name: '烧卖', category: '主食', caloriesPer100g: 215, proteinPer100g: 8.0, fatPer100g: 8.0, carbsPer100g: 27.0, standardServingG: 120, standardServingDesc: '4个约120g', searchWeight: 130 },
  { name: '粽子（猪肉）', aliases: '肉粽', category: '主食', caloriesPer100g: 195, proteinPer100g: 6.0, fatPer100g: 5.5, carbsPer100g: 31.0, standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 130 },
  { name: '全麦面包', aliases: '吐司,全麦吐司', category: '主食', caloriesPer100g: 246, proteinPer100g: 8.5, fatPer100g: 3.5, carbsPer100g: 44.8, standardServingG: 60, standardServingDesc: '2片约60g', searchWeight: 150 },
  { name: '红薯（蒸）', aliases: '地瓜,番薯', category: '主食', caloriesPer100g: 86, proteinPer100g: 1.6, fatPer100g: 0.1, carbsPer100g: 20.1, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 145 },
  { name: '玉米（煮）', aliases: '煮玉米', category: '主食', caloriesPer100g: 112, proteinPer100g: 4.0, fatPer100g: 1.2, carbsPer100g: 22.8, standardServingG: 200, standardServingDesc: '1根约200g', searchWeight: 140 },
  { name: '小笼包', aliases: '灌汤包', category: '主食', caloriesPer100g: 220, proteinPer100g: 10.0, fatPer100g: 8.5, carbsPer100g: 25.0, standardServingG: 120, standardServingDesc: '6个约120g', searchWeight: 155 },
  { name: '凉皮', aliases: '陕西凉皮', category: '主食', caloriesPer100g: 117, proteinPer100g: 3.5, fatPer100g: 2.0, carbsPer100g: 21.5, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 140 },

  // ===== 肉类/海鲜 (35) =====
  { name: '宫保鸡丁', aliases: '宫爆鸡丁', category: '肉类', caloriesPer100g: 197, proteinPer100g: 15.0, fatPer100g: 12.0, carbsPer100g: 7.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 200 },
  { name: '鸡胸肉（水煮）', aliases: '白煮鸡胸,水煮鸡胸肉', category: '肉类', caloriesPer100g: 133, proteinPer100g: 31.0, fatPer100g: 1.2, carbsPer100g: 0, standardServingG: 150, standardServingDesc: '1块约150g', searchWeight: 195 },
  { name: '红烧肉', aliases: '东坡肉', category: '肉类', caloriesPer100g: 356, proteinPer100g: 11.0, fatPer100g: 32.0, carbsPer100g: 6.0, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 185 },
  { name: '水煮鱼', aliases: '水煮鱼片', category: '肉类', caloriesPer100g: 143, proteinPer100g: 16.0, fatPer100g: 8.0, carbsPer100g: 1.5, standardServingG: 300, standardServingDesc: '1份约300g（含汤）', searchWeight: 180 },
  { name: '回锅肉', category: '肉类', caloriesPer100g: 270, proteinPer100g: 12.0, fatPer100g: 22.0, carbsPer100g: 5.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '糖醋排骨', aliases: '糖醋小排', category: '肉类', caloriesPer100g: 245, proteinPer100g: 13.0, fatPer100g: 14.0, carbsPer100g: 16.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 170 },
  { name: '红烧排骨', category: '肉类', caloriesPer100g: 268, proteinPer100g: 16.0, fatPer100g: 20.0, carbsPer100g: 5.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 165 },
  { name: '鱼香肉丝', category: '肉类', caloriesPer100g: 186, proteinPer100g: 12.0, fatPer100g: 11.0, carbsPer100g: 10.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '清蒸鱼', aliases: '清蒸鲈鱼,蒸鱼', category: '肉类', caloriesPer100g: 105, proteinPer100g: 18.0, fatPer100g: 3.5, carbsPer100g: 0.5, standardServingG: 250, standardServingDesc: '1份约250g', searchWeight: 155 },
  { name: '白切鸡', aliases: '白斩鸡', category: '肉类', caloriesPer100g: 167, proteinPer100g: 19.0, fatPer100g: 9.5, carbsPer100g: 0.5, standardServingG: 200, standardServingDesc: '半只约200g', searchWeight: 155 },
  { name: '烤鸡腿', aliases: '烤鸡', category: '肉类', caloriesPer100g: 190, proteinPer100g: 20.0, fatPer100g: 11.0, carbsPer100g: 2.0, standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 160 },
  { name: '北京烤鸭', aliases: '烤鸭', category: '肉类', caloriesPer100g: 240, proteinPer100g: 16.0, fatPer100g: 18.0, carbsPer100g: 3.0, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 170 },
  { name: '酸菜鱼', category: '肉类', caloriesPer100g: 120, proteinPer100g: 14.0, fatPer100g: 6.0, carbsPer100g: 2.0, standardServingG: 350, standardServingDesc: '1份约350g（含汤）', searchWeight: 170 },
  { name: '红烧牛肉', aliases: '牛腩', category: '肉类', caloriesPer100g: 193, proteinPer100g: 22.0, fatPer100g: 10.0, carbsPer100g: 3.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 165 },
  { name: '牛排（煎，七分熟）', aliases: '牛排', category: '肉类', caloriesPer100g: 211, proteinPer100g: 27.0, fatPer100g: 11.0, carbsPer100g: 0, standardServingG: 200, standardServingDesc: '1块约200g', searchWeight: 160 },
  { name: '水煮虾', aliases: '白灼虾,基围虾', category: '肉类', caloriesPer100g: 93, proteinPer100g: 18.6, fatPer100g: 1.5, carbsPer100g: 0.8, standardServingG: 150, standardServingDesc: '1份约150g（去壳）', searchWeight: 150 },
  { name: '红烧茄子', category: '肉类', caloriesPer100g: 95, proteinPer100g: 1.5, fatPer100g: 6.0, carbsPer100g: 9.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 145 },
  { name: '辣子鸡', aliases: '辣子鸡丁', category: '肉类', caloriesPer100g: 238, proteinPer100g: 16.0, fatPer100g: 16.0, carbsPer100g: 8.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 155 },
  { name: '可乐鸡翅', category: '肉类', caloriesPer100g: 198, proteinPer100g: 16.0, fatPer100g: 10.0, carbsPer100g: 10.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '咕噜肉', aliases: '甜酸肉,咕咾肉', category: '肉类', caloriesPer100g: 235, proteinPer100g: 10.0, fatPer100g: 14.0, carbsPer100g: 17.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '麻婆豆腐', category: '豆制品', caloriesPer100g: 97, proteinPer100g: 7.5, fatPer100g: 5.5, carbsPer100g: 4.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '炸鸡块', aliases: '炸鸡,炸鸡腿', category: '肉类', caloriesPer100g: 280, proteinPer100g: 16.0, fatPer100g: 18.0, carbsPer100g: 12.0, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 170 },
  { name: '水煮肉片', category: '肉类', caloriesPer100g: 182, proteinPer100g: 14.0, fatPer100g: 12.0, carbsPer100g: 4.5, standardServingG: 300, standardServingDesc: '1份约300g（含汤）', searchWeight: 160 },
  { name: '京酱肉丝', category: '肉类', caloriesPer100g: 195, proteinPer100g: 14.0, fatPer100g: 12.0, carbsPer100g: 8.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '蒜泥白肉', category: '肉类', caloriesPer100g: 260, proteinPer100g: 14.0, fatPer100g: 22.0, carbsPer100g: 2.0, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 130 },
  { name: '铁板牛柳', category: '肉类', caloriesPer100g: 180, proteinPer100g: 18.0, fatPer100g: 10.0, carbsPer100g: 5.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '烤羊肉串', aliases: '羊肉串', category: '肉类', caloriesPer100g: 206, proteinPer100g: 18.0, fatPer100g: 14.0, carbsPer100g: 1.5, standardServingG: 100, standardServingDesc: '5串约100g', searchWeight: 155 },
  { name: '小龙虾（麻辣）', aliases: '麻辣小龙虾', category: '肉类', caloriesPer100g: 93, proteinPer100g: 15.0, fatPer100g: 3.0, carbsPer100g: 1.0, standardServingG: 200, standardServingDesc: '1份约200g（去壳）', searchWeight: 165 },
  { name: '烤鱼', category: '肉类', caloriesPer100g: 154, proteinPer100g: 17.0, fatPer100g: 8.5, carbsPer100g: 2.5, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 155 },
  { name: '猪蹄（卤）', aliases: '卤猪蹄', category: '肉类', caloriesPer100g: 260, proteinPer100g: 23.0, fatPer100g: 18.0, carbsPer100g: 1.5, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 130 },

  // ===== 蔬菜/豆制品 (25) =====
  { name: '西红柿炒鸡蛋', aliases: '番茄炒蛋', category: '蔬菜', caloriesPer100g: 86, proteinPer100g: 5.0, fatPer100g: 5.0, carbsPer100g: 5.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 190 },
  { name: '炒青菜', aliases: '清炒菜心,炒菜心', category: '蔬菜', caloriesPer100g: 45, proteinPer100g: 1.5, fatPer100g: 2.5, carbsPer100g: 3.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 170 },
  { name: '醋溜土豆丝', aliases: '土豆丝,炒土豆丝', category: '蔬菜', caloriesPer100g: 85, proteinPer100g: 2.0, fatPer100g: 3.5, carbsPer100g: 12.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '拍黄瓜', aliases: '凉拌黄瓜', category: '蔬菜', caloriesPer100g: 35, proteinPer100g: 0.8, fatPer100g: 1.5, carbsPer100g: 3.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 160 },
  { name: '地三鲜', category: '蔬菜', caloriesPer100g: 120, proteinPer100g: 2.5, fatPer100g: 8.0, carbsPer100g: 10.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '干煸四季豆', aliases: '炒四季豆', category: '蔬菜', caloriesPer100g: 95, proteinPer100g: 3.0, fatPer100g: 5.5, carbsPer100g: 8.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '蒜蓉西兰花', aliases: '炒西兰花', category: '蔬菜', caloriesPer100g: 48, proteinPer100g: 3.5, fatPer100g: 2.0, carbsPer100g: 4.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 155 },
  { name: '凉拌木耳', category: '蔬菜', caloriesPer100g: 42, proteinPer100g: 1.5, fatPer100g: 2.0, carbsPer100g: 4.5, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 130 },
  { name: '炒藕片', aliases: '醋溜藕片', category: '蔬菜', caloriesPer100g: 78, proteinPer100g: 1.5, fatPer100g: 3.0, carbsPer100g: 11.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '炒豆芽', aliases: '清炒绿豆芽', category: '蔬菜', caloriesPer100g: 42, proteinPer100g: 2.5, fatPer100g: 2.0, carbsPer100g: 3.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '皮蛋豆腐', aliases: '凉拌皮蛋', category: '豆制品', caloriesPer100g: 85, proteinPer100g: 7.0, fatPer100g: 5.5, carbsPer100g: 2.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '家常豆腐', category: '豆制品', caloriesPer100g: 120, proteinPer100g: 8.0, fatPer100g: 7.5, carbsPer100g: 5.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 145 },
  { name: '蒜蒸茄子', aliases: '蒸茄子', category: '蔬菜', caloriesPer100g: 62, proteinPer100g: 1.0, fatPer100g: 3.5, carbsPer100g: 6.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 115 },
  { name: '手撕包菜', aliases: '炒包菜', category: '蔬菜', caloriesPer100g: 55, proteinPer100g: 1.5, fatPer100g: 3.0, carbsPer100g: 5.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 135 },
  { name: '酸辣土豆丝', category: '蔬菜', caloriesPer100g: 88, proteinPer100g: 2.0, fatPer100g: 3.5, carbsPer100g: 12.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 160 },
  { name: '虎皮青椒', aliases: '擂椒皮蛋', category: '蔬菜', caloriesPer100g: 65, proteinPer100g: 1.5, fatPer100g: 4.0, carbsPer100g: 5.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '蒜苗炒肉', aliases: '蒜苔炒肉', category: '蔬菜', caloriesPer100g: 135, proteinPer100g: 8.0, fatPer100g: 8.5, carbsPer100g: 6.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 130 },
  { name: '清炒山药', aliases: '炒山药', category: '蔬菜', caloriesPer100g: 75, proteinPer100g: 1.5, fatPer100g: 2.5, carbsPer100g: 12.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '尖椒干豆腐', aliases: '干豆腐', category: '豆制品', caloriesPer100g: 125, proteinPer100g: 9.0, fatPer100g: 7.5, carbsPer100g: 5.5, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '凉拌三丝', category: '蔬菜', caloriesPer100g: 55, proteinPer100g: 1.5, fatPer100g: 2.5, carbsPer100g: 6.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 110 },

  // ===== 汤类 (10) =====
  { name: '西红柿蛋汤', aliases: '番茄蛋花汤', category: '汤类', caloriesPer100g: 28, proteinPer100g: 1.5, fatPer100g: 1.2, carbsPer100g: 2.5, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 160 },
  { name: '紫菜蛋花汤', category: '汤类', caloriesPer100g: 22, proteinPer100g: 1.8, fatPer100g: 0.8, carbsPer100g: 1.8, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 145 },
  { name: '排骨汤', aliases: '排骨萝卜汤', category: '汤类', caloriesPer100g: 48, proteinPer100g: 3.5, fatPer100g: 2.5, carbsPer100g: 2.5, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 140 },
  { name: '冬瓜汤', aliases: '冬瓜排骨汤', category: '汤类', caloriesPer100g: 15, proteinPer100g: 0.5, fatPer100g: 0.3, carbsPer100g: 2.5, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 120 },
  { name: '豆腐汤', category: '汤类', caloriesPer100g: 32, proteinPer100g: 2.5, fatPer100g: 1.5, carbsPer100g: 2.0, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 115 },
  { name: '酸辣汤', category: '汤类', caloriesPer100g: 38, proteinPer100g: 2.0, fatPer100g: 1.5, carbsPer100g: 4.0, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 135 },
  { name: '玉米排骨汤', category: '汤类', caloriesPer100g: 45, proteinPer100g: 3.0, fatPer100g: 2.0, carbsPer100g: 3.5, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 130 },
  { name: '鸡蛋汤', aliases: '蛋花汤', category: '汤类', caloriesPer100g: 25, proteinPer100g: 1.5, fatPer100g: 1.0, carbsPer100g: 2.0, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 120 },
  { name: '银耳莲子汤', aliases: '银耳汤', category: '汤类', caloriesPer100g: 42, proteinPer100g: 0.8, fatPer100g: 0.2, carbsPer100g: 9.5, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 115 },
  { name: '胡辣汤', category: '汤类', caloriesPer100g: 55, proteinPer100g: 2.5, fatPer100g: 2.0, carbsPer100g: 7.0, standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 130 },

  // ===== 快餐/外卖 (20) =====
  { name: '黄焖鸡米饭', aliases: '黄焖鸡', category: '快餐', caloriesPer100g: 145, proteinPer100g: 8.5, fatPer100g: 6.5, carbsPer100g: 13.0, standardServingG: 400, standardServingDesc: '1份约400g（含米饭）', searchWeight: 185 },
  { name: '麻辣烫', aliases: '冒菜', category: '快餐', caloriesPer100g: 88, proteinPer100g: 4.0, fatPer100g: 4.5, carbsPer100g: 8.0, standardServingG: 500, standardServingDesc: '1碗约500g', searchWeight: 185 },
  { name: '沙县炒饭', aliases: '扬州炒饭', category: '快餐', caloriesPer100g: 170, proteinPer100g: 5.0, fatPer100g: 6.0, carbsPer100g: 24.0, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 170 },
  { name: '麦辣鸡腿堡', aliases: '麦当劳鸡腿堡', category: '快餐', caloriesPer100g: 245, proteinPer100g: 13.0, fatPer100g: 12.5, carbsPer100g: 21.0, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 175 },
  { name: '巨无霸', aliases: '麦当劳巨无霸', category: '快餐', caloriesPer100g: 229, proteinPer100g: 12.5, fatPer100g: 11.5, carbsPer100g: 19.5, standardServingG: 215, standardServingDesc: '1个约215g', searchWeight: 170 },
  { name: '薯条（大份）', aliases: '麦当劳薯条', category: '快餐', caloriesPer100g: 312, proteinPer100g: 3.4, fatPer100g: 15.0, carbsPer100g: 41.0, standardServingG: 150, standardServingDesc: '大份约150g', searchWeight: 165 },
  { name: '烧腊饭（叉烧）', aliases: '叉烧饭', category: '快餐', caloriesPer100g: 160, proteinPer100g: 8.0, fatPer100g: 5.5, carbsPer100g: 20.0, standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 160 },
  { name: '盖浇饭（鱼香肉丝）', aliases: '鱼香肉丝盖饭', category: '快餐', caloriesPer100g: 155, proteinPer100g: 7.0, fatPer100g: 5.5, carbsPer100g: 20.0, standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 160 },
  { name: '煲仔饭', aliases: '煲仔饭腊味', category: '快餐', caloriesPer100g: 175, proteinPer100g: 7.5, fatPer100g: 6.0, carbsPer100g: 24.0, standardServingG: 400, standardServingDesc: '1煲约400g', searchWeight: 150 },
  { name: '烤肉拌饭', category: '快餐', caloriesPer100g: 165, proteinPer100g: 9.0, fatPer100g: 6.5, carbsPer100g: 18.0, standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 150 },
  { name: '鸡排饭', aliases: '大鸡排饭', category: '快餐', caloriesPer100g: 175, proteinPer100g: 10.0, fatPer100g: 7.0, carbsPer100g: 18.5, standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 155 },
  { name: '沙拉（鸡胸肉）', aliases: '鸡胸沙拉', category: '快餐', caloriesPer100g: 75, proteinPer100g: 9.0, fatPer100g: 2.5, carbsPer100g: 5.0, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 150 },
  { name: '肯德基原味鸡', aliases: 'KFC原味鸡', category: '快餐', caloriesPer100g: 250, proteinPer100g: 17.0, fatPer100g: 15.0, carbsPer100g: 11.0, standardServingG: 120, standardServingDesc: '1块约120g', searchWeight: 160 },
  { name: '关东煮', aliases: '7-11关东煮', category: '快餐', caloriesPer100g: 55, proteinPer100g: 4.0, fatPer100g: 1.5, carbsPer100g: 6.0, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 130 },
  { name: '兰州牛肉面', aliases: '兰州拉面套餐', category: '快餐', caloriesPer100g: 95, proteinPer100g: 5.0, fatPer100g: 2.5, carbsPer100g: 14.0, standardServingG: 500, standardServingDesc: '1碗约500g', searchWeight: 160 },
  { name: '沙县拌面', aliases: '沙县小吃拌面', category: '快餐', caloriesPer100g: 145, proteinPer100g: 4.5, fatPer100g: 4.5, carbsPer100g: 22.0, standardServingG: 250, standardServingDesc: '1碗约250g', searchWeight: 140 },
  { name: '酸辣粉', category: '快餐', caloriesPer100g: 98, proteinPer100g: 2.5, fatPer100g: 3.5, carbsPer100g: 15.0, standardServingG: 400, standardServingDesc: '1碗约400g', searchWeight: 155 },
  { name: '炸酱面', category: '快餐', caloriesPer100g: 145, proteinPer100g: 6.0, fatPer100g: 5.0, carbsPer100g: 19.0, standardServingG: 350, standardServingDesc: '1碗约350g', searchWeight: 145 },
  { name: '肉夹馍', aliases: '腊汁肉夹馍', category: '快餐', caloriesPer100g: 233, proteinPer100g: 10.0, fatPer100g: 9.0, carbsPer100g: 28.0, standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 155 },
  { name: '卷饼（鸡肉）', aliases: '鸡肉卷', category: '快餐', caloriesPer100g: 195, proteinPer100g: 11.0, fatPer100g: 7.5, carbsPer100g: 21.0, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 135 },

  // ===== 水果 (15) =====
  { name: '苹果', category: '水果', caloriesPer100g: 52, proteinPer100g: 0.3, fatPer100g: 0.2, carbsPer100g: 13.5, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 180 },
  { name: '香蕉', category: '水果', caloriesPer100g: 93, proteinPer100g: 1.4, fatPer100g: 0.2, carbsPer100g: 22.0, standardServingG: 120, standardServingDesc: '1根约120g（去皮）', searchWeight: 175 },
  { name: '西瓜', category: '水果', caloriesPer100g: 31, proteinPer100g: 0.5, fatPer100g: 0.1, carbsPer100g: 7.1, standardServingG: 300, standardServingDesc: '1块约300g', searchWeight: 170 },
  { name: '草莓', category: '水果', caloriesPer100g: 32, proteinPer100g: 1.0, fatPer100g: 0.2, carbsPer100g: 7.1, standardServingG: 150, standardServingDesc: '8颗约150g', searchWeight: 150 },
  { name: '橙子', category: '水果', caloriesPer100g: 48, proteinPer100g: 0.8, fatPer100g: 0.2, carbsPer100g: 11.1, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 155 },
  { name: '葡萄', category: '水果', caloriesPer100g: 45, proteinPer100g: 0.5, fatPer100g: 0.2, carbsPer100g: 10.3, standardServingG: 200, standardServingDesc: '1小份约200g', searchWeight: 140 },
  { name: '芒果', category: '水果', caloriesPer100g: 65, proteinPer100g: 0.6, fatPer100g: 0.3, carbsPer100g: 15.0, standardServingG: 200, standardServingDesc: '1个约200g（去皮）', searchWeight: 150 },
  { name: '火龙果', category: '水果', caloriesPer100g: 55, proteinPer100g: 1.1, fatPer100g: 0.2, carbsPer100g: 13.3, standardServingG: 200, standardServingDesc: '半个约200g', searchWeight: 140 },
  { name: '桃子', category: '水果', caloriesPer100g: 48, proteinPer100g: 0.9, fatPer100g: 0.1, carbsPer100g: 11.0, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 130 },
  { name: '猕猴桃', aliases: '奇异果', category: '水果', caloriesPer100g: 56, proteinPer100g: 0.8, fatPer100g: 0.6, carbsPer100g: 11.9, standardServingG: 100, standardServingDesc: '1个约100g', searchWeight: 140 },
  { name: '梨', category: '水果', caloriesPer100g: 50, proteinPer100g: 0.1, fatPer100g: 0.1, carbsPer100g: 12.0, standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 125 },
  { name: '哈密瓜', category: '水果', caloriesPer100g: 34, proteinPer100g: 0.5, fatPer100g: 0.1, carbsPer100g: 7.9, standardServingG: 200, standardServingDesc: '1块约200g', searchWeight: 125 },
  { name: '车厘子', aliases: '樱桃', category: '水果', caloriesPer100g: 46, proteinPer100g: 1.1, fatPer100g: 0.2, carbsPer100g: 10.2, standardServingG: 150, standardServingDesc: '1小份约150g', searchWeight: 140 },
  { name: '柚子', category: '水果', caloriesPer100g: 42, proteinPer100g: 0.8, fatPer100g: 0.2, carbsPer100g: 9.5, standardServingG: 200, standardServingDesc: '几瓣约200g', searchWeight: 130 },
  { name: '蓝莓', category: '水果', caloriesPer100g: 57, proteinPer100g: 0.7, fatPer100g: 0.3, carbsPer100g: 14.5, standardServingG: 100, standardServingDesc: '1盒约100g', searchWeight: 135 },

  // ===== 饮品 (15) =====
  { name: '珍珠奶茶（正常糖）', aliases: '奶茶,珍珠奶茶', category: '饮品', caloriesPer100g: 70, proteinPer100g: 1.0, fatPer100g: 2.0, carbsPer100g: 12.0, standardServingG: 500, standardServingDesc: '1杯约500ml', searchWeight: 195 },
  { name: '美式咖啡（无糖）', aliases: '美式,黑咖啡', category: '饮品', caloriesPer100g: 2, proteinPer100g: 0.1, fatPer100g: 0, carbsPer100g: 0.3, standardServingG: 360, standardServingDesc: '1杯约360ml', searchWeight: 160 },
  { name: '拿铁咖啡', aliases: '拿铁,热拿铁', category: '饮品', caloriesPer100g: 40, proteinPer100g: 2.0, fatPer100g: 1.5, carbsPer100g: 4.5, standardServingG: 360, standardServingDesc: '1杯约360ml', searchWeight: 165 },
  { name: '可口可乐', aliases: '可乐', category: '饮品', caloriesPer100g: 43, proteinPer100g: 0, fatPer100g: 0, carbsPer100g: 10.6, standardServingG: 330, standardServingDesc: '1罐330ml', searchWeight: 175 },
  { name: '全脂牛奶', aliases: '牛奶,纯牛奶', category: '饮品', caloriesPer100g: 65, proteinPer100g: 3.0, fatPer100g: 3.6, carbsPer100g: 5.0, standardServingG: 250, standardServingDesc: '1盒约250ml', searchWeight: 170 },
  { name: '低脂牛奶', aliases: '脱脂牛奶', category: '饮品', caloriesPer100g: 42, proteinPer100g: 3.4, fatPer100g: 1.0, carbsPer100g: 5.0, standardServingG: 250, standardServingDesc: '1盒约250ml', searchWeight: 140 },
  { name: '豆浆（无糖）', aliases: '豆浆', category: '饮品', caloriesPer100g: 31, proteinPer100g: 2.9, fatPer100g: 1.2, carbsPer100g: 1.8, standardServingG: 300, standardServingDesc: '1碗约300ml', searchWeight: 155 },
  { name: '橙汁（鲜榨）', aliases: '橙汁,果汁', category: '饮品', caloriesPer100g: 45, proteinPer100g: 0.7, fatPer100g: 0.2, carbsPer100g: 10.5, standardServingG: 300, standardServingDesc: '1杯约300ml', searchWeight: 140 },
  { name: '酸奶（原味）', aliases: '酸奶', category: '饮品', caloriesPer100g: 72, proteinPer100g: 3.1, fatPer100g: 2.7, carbsPer100g: 9.0, standardServingG: 200, standardServingDesc: '1杯约200g', searchWeight: 155 },
  { name: '雪碧', aliases: '七喜', category: '饮品', caloriesPer100g: 41, proteinPer100g: 0, fatPer100g: 0, carbsPer100g: 10.2, standardServingG: 330, standardServingDesc: '1罐330ml', searchWeight: 140 },
  { name: '红茶（无糖）', aliases: '冰红茶', category: '饮品', caloriesPer100g: 1, proteinPer100g: 0, fatPer100g: 0, carbsPer100g: 0.2, standardServingG: 300, standardServingDesc: '1杯约300ml', searchWeight: 115 },
  { name: '啤酒', category: '饮品', caloriesPer100g: 43, proteinPer100g: 0.4, fatPer100g: 0, carbsPer100g: 3.4, standardServingG: 500, standardServingDesc: '1瓶约500ml', searchWeight: 155 },
  { name: '红酒', aliases: '葡萄酒', category: '饮品', caloriesPer100g: 83, proteinPer100g: 0.1, fatPer100g: 0, carbsPer100g: 2.6, standardServingG: 150, standardServingDesc: '1杯约150ml', searchWeight: 130 },
  { name: '椰子水', category: '饮品', caloriesPer100g: 19, proteinPer100g: 0.7, fatPer100g: 0.2, carbsPer100g: 3.7, standardServingG: 330, standardServingDesc: '1瓶约330ml', searchWeight: 120 },
  { name: '运动饮料', aliases: '脉动,佳得乐', category: '饮品', caloriesPer100g: 26, proteinPer100g: 0, fatPer100g: 0, carbsPer100g: 6.4, standardServingG: 500, standardServingDesc: '1瓶约500ml', searchWeight: 120 },

  // ===== 零食/其他 (10) =====
  { name: '鸡蛋（煮）', aliases: '水煮蛋,白煮蛋', category: '零食', caloriesPer100g: 144, proteinPer100g: 13.3, fatPer100g: 8.8, carbsPer100g: 2.8, standardServingG: 60, standardServingDesc: '1个约60g', searchWeight: 185 },
  { name: '茶叶蛋', category: '零食', caloriesPer100g: 144, proteinPer100g: 13.0, fatPer100g: 8.8, carbsPer100g: 3.0, standardServingG: 60, standardServingDesc: '1个约60g', searchWeight: 150 },
  { name: '薯片', aliases: '乐事薯片', category: '零食', caloriesPer100g: 540, proteinPer100g: 5.0, fatPer100g: 35.0, carbsPer100g: 52.0, standardServingG: 40, standardServingDesc: '小份约40g', searchWeight: 160 },
  { name: '坚果（混合）', aliases: '每日坚果,坚果', category: '零食', caloriesPer100g: 580, proteinPer100g: 17.0, fatPer100g: 50.0, carbsPer100g: 18.0, standardServingG: 25, standardServingDesc: '1小袋约25g', searchWeight: 155 },
  { name: '巧克力', aliases: '德芙巧克力', category: '零食', caloriesPer100g: 545, proteinPer100g: 4.8, fatPer100g: 31.0, carbsPer100g: 60.0, standardServingG: 40, standardServingDesc: '1排约40g', searchWeight: 140 },
  { name: '辣条', aliases: '卫龙辣条', category: '零食', caloriesPer100g: 420, proteinPer100g: 12.0, fatPer100g: 22.0, carbsPer100g: 42.0, standardServingG: 100, standardServingDesc: '1包约100g', searchWeight: 150 },
  { name: '面包（奶油）', aliases: '奶油面包', category: '零食', caloriesPer100g: 313, proteinPer100g: 7.0, fatPer100g: 9.0, carbsPer100g: 50.0, standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 135 },
  { name: '蛋糕（奶油）', aliases: '生日蛋糕', category: '零食', caloriesPer100g: 348, proteinPer100g: 5.5, fatPer100g: 17.0, carbsPer100g: 43.0, standardServingG: 100, standardServingDesc: '1块约100g', searchWeight: 140 },
  { name: '冰淇淋', aliases: '雪糕', category: '零食', caloriesPer100g: 207, proteinPer100g: 3.5, fatPer100g: 11.0, carbsPer100g: 23.5, standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 145 },
  { name: '饼干（苏打）', aliases: '苏打饼干', category: '零食', caloriesPer100g: 408, proteinPer100g: 8.0, fatPer100g: 8.5, carbsPer100g: 75.0, standardServingG: 30, standardServingDesc: '4块约30g', searchWeight: 120 },
].map(food => ({ ...food, tags: deriveTags(food), source: 'official' as const, confidence: 0.95 }));
