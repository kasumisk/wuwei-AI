# 营养评分异常与推荐贴近现实改造分析

日期：2026-04-10

## 结论摘要

当前“记录了早、午、晚、加餐，但首页评分仍明显偏低”的问题，不是单一原因。

结论分两层：

1. 当前低分里存在已确认的数据链路与前后端契约问题，属于 bug。
2. 当前推荐系统虽然已经不只是按热量推荐，但“贴近现实”的约束仍明显不足，属于系统设计不完整。

从代码看，截图里这类“热量、蛋白、脂肪、碳水看起来还可以，但总分只有 41”的情况，更大概率是“质量分、饱腹感、营养扩展字段没有稳定写入”，不是纯公式本身导致。

## 一、已确认问题

### 1. 推荐计划一键记录时，没有把质量分和饱腹感写入记录

Web 端按计划一键记录时，只写入了：

- foods
- totalCalories
- totalProtein
- totalFat
- totalCarbs

但没有写入：

- avgQuality
- avgSatiety
- nutritionScore

这意味着用户即使完全按计划吃，日汇总里的 avgQuality 和 avgSatiety 仍可能长期为 0，首页总分会被明显拉低。

相关实现：

- apps/web/src/features/home/components/daily-plan-card.tsx

### 2. 小程序拍照分析保存时，没有把扩展营养字段带回后端

小程序拍照分析页保存记录时，只传：

- foods
- totalCalories
- mealType
- imageUrl
- advice
- isHealthy

没有传：

- totalProtein
- totalFat
- totalCarbs
- avgQuality
- avgSatiety
- nutritionScore

这会直接导致首页 summary.nutritionScore 偏低，尤其健康维持目标下，食物质量权重较高时影响更明显。

相关实现：

- apps/miniapp/src/pages/analyze/index.tsx
- apps/miniapp/src/services/food.ts

### 3. 首页总分和详情评分走了两套不完全一致的数据路径

首页状态卡使用的是 DailySummary 里的 nutritionScore。

而详情营养评分接口会重新调用 NutritionScoreService.calculateScore，并且对缺失的 avgQuality 和 avgSatiety 做了 fallback：

- foodQuality: summary.avgQuality || 3
- satiety: summary.avgSatiety || 3

这会造成：

- 首页总分偏低
- 详情页六维分看起来相对正常
- 用户感觉“同一天、同一份饮食，为什么总分和细项对不上”

相关实现：

- apps/api-server/src/modules/diet/app/daily-summary.service.ts
- apps/api-server/src/modules/diet/app/food-nutrition.controller.ts

### 4. Web 端营养评分接口契约不一致

后端 nutrition-score 接口返回的是：

- score
- breakdown
- highlights
- decision
- goals
- intake

前端类型和组件却按下面结构消费：

- totalScore
- breakdown
- highlights
- feedback
- goals
- intake

也就是说，至少存在两个明确不一致点：

- score vs totalScore
- feedback 字段前端需要，但接口未返回

这类问题会导致：

- 总分显示异常
- 文案为空或不稳定
- 某些端出现展示异常

相关实现：

- apps/api-server/src/modules/diet/app/food-nutrition.controller.ts
- apps/web/src/types/food.ts
- apps/web/src/features/home/components/nutrition-score-card.tsx

### 5. 当前 41 分并不主要是“热量公式算错”

从现有公式看，若用户当天是健康维持目标，摄入 1815 kcal，目标 2269 kcal，则 energy 维度大约只有 41 分，这本身是偏严格的，但还不足以单独把总分打到 41。

真正会把总分压到截图这种水平的，是下面这种情况叠加：

- avgQuality 接近 0
- avgSatiety 接近 0 或偏低
- 首页直接用 DailySummary.nutritionScore

因此目前更像是：

- 主因：记录链路漏字段
- 次因：健康目标下能量评分偏严格

不是“推荐系统本身完全失效”。

## 二、为什么当前推荐不贴近现实

### 1. 当前系统的核心约束仍然以营养标签为中心

当前约束生成器主要关注：

- high_protein
- low_calorie
- low_gi
- low_sodium
- 过敏原
- 健康状况
- 餐次标签

这能保证“营养上合理”，但不能保证“现实中会吃”。

缺的是真正影响执行的约束：

- 预算
- 本地常见程度
- 购买渠道
- 是否适合外卖
- 是否适合便利店
- 做饭时间
- 烹饪技能
- 厨房设备
- 是否家常
- 家庭/伴侣共食场景

### 2. 地区加权有雏形，但力度和数据完整度都不够

系统已经有 FoodRegionalInfo 和 regionalBoostMap，但当前权重范围只有大约 0.85 到 1.08。

这有两个问题：

1. 如果候选食物池本身就充满“不常见但营养很优”的食物，1.08 这种轻微加权不够把常见食材顶上来。
2. 如果 regional info 数据不全，那么大量食物根本没有地区修正，相当于没起作用。

### 3. 多目标优化里有 cost 和 convenience，但不代表默认结果就“家常”

代码里已经有多目标优化器，目标包括：

- health
- taste
- cost
- convenience

但现实问题在于：

- 是否默认启用，取决于策略配置
- convenience 更偏“省时/易获得”，不等于“用户熟悉、愿意吃”
- familiarity（熟悉度）没有成为核心目标
- budget 和 channel availability 还没有形成强约束

所以系统现在更像“理论上支持现实性”，但默认推荐逻辑还没有把现实性真正放到第一层。

### 4. 计划餐的一键记录本质上是字符串拆分，不是真实食物实体落库

当前计划一键记录会把 foods 字符串按顿号、逗号拆成若干 food item，然后平均分配热量和宏量。

这有两个问题：

1. 记录不是真实食物库实体，后续反馈学习质量有限。
2. 质量分、饱腹感、GI、价格、便利性等关键属性没有跟着落库。

也就是说，推荐计划虽然看起来是“结构化推荐”，但记录回流仍然是“半结构化、弱语义”。

这会直接削弱：

- 评分准确性
- 用户行为学习
- 后续推荐个性化

## 三、系统应该怎么调

## 3.1 第一优先级：先修评分可信度

这是必须先做的，因为如果评分不可信，推荐再聪明，用户也不会信。

### P0-1. 统一所有记录入口的数据写入标准

所有 saveRecord 路径必须统一要求写入：

- totalCalories
- totalProtein
- totalFat
- totalCarbs
- avgQuality
- avgSatiety
- nutritionScore

适用入口：

- Web 拍照分析保存
- Web 计划一键记录
- 小程序拍照分析保存
- 后续任何手动搜索保存

最低要求：如果没有精确值，也要写入“中性默认值”而不是 0。

建议默认值：

- avgQuality = 5
- avgSatiety = 5

不要让“缺失数据”被解释成“垃圾饮食”。

### P0-2. 统一首页与详情页评分口径

建议只保留一种口径：

方案 A：首页直接调用 nutrition-score 接口结果

优点：

- 前后端口径统一
- 避免 summary 中旧分数、缺省分数与实时分数不一致

方案 B：DailySummary 保存实时重算结果，但接口和首页都只信 summary

前提：

- DailySummary 回写必须稳定
- 所有字段都必须完整

当前阶段更建议先用方案 A，先把用户看到的结果统一。

### P0-3. 修复接口契约

统一为一个稳定返回结构，例如：

```ts
{
  totalScore: number,
  breakdown: {
    energy: number,
    proteinRatio: number,
    macroBalance: number,
    foodQuality: number,
    satiety: number,
    stability: number,
    glycemicImpact?: number,
  },
  highlights: string[],
  feedback: string,
  goals: {...},
  intake: {...}
}
```

不要再让前端自己猜 score 和 totalScore 的关系。

### P0-4. 对历史 summary 做一次回填重算

修复新代码后，历史数据仍然会因为旧记录缺字段而继续显示异常。

建议增加一次回填任务：

1. 按天遍历 food_records
2. 重算 totalProtein / totalFat / totalCarbs
3. 若 avgQuality / avgSatiety 缺失，则按中性值 5 回填
4. 重算 nutritionScore
5. 更新 daily_summaries

否则用户会持续看到“旧脏数据”。

## 3.2 第二优先级：让评分更符合用户直觉

### P1-1. 健康维持目标的 energy 评分放宽

当前 health 目标对“未吃满目标热量”的扣分偏明显。

例如 1815 / 2269 kcal，在用户主观上通常属于“还可以”，但 energy 会落到约 41。

建议：

- fat_loss 保持较严格
- muscle_gain 对未达标更敏感
- health 和 habit 应使用更宽容的区间

可选改法：

1. 增大 health 的 sigma
2. 改成分段容忍区间
3. 只对偏差超过 20% 后再显著扣分

更符合用户认知的健康目标建议：

- 90% 到 110% 视为优良区
- 80% 到 120% 视为可接受区
- 超出后再快速扣分

### P1-2. 把“数据可信度”从“营养得分”里拆出去

当前缺数据时，系统会直接体现在低分上。

更合理的做法是拆成两层：

- Nutrition Score：饮食本身好不好
- Data Confidence：这次判断靠不靠谱

例如：

- 分数 76
- 可信度 中等
- 提示：本次记录缺少部分食物质量数据，建议完善食材信息

这样用户不会把“模型没拿到数据”理解成“你今天吃得很差”。

## 3.3 第三优先级：让推荐真正贴近现实

这里要从“营养最优”改成“营养可执行最优”。

### P2-1. 在用户画像里加入现实执行约束

建议新增用户长期画像字段：

- budgetLevel：低 / 中 / 高
- cookingSkill：不会做 / 会简单做 / 熟练
- prepTimeLimit：10min / 20min / 40min
- availableEquipment：微波炉 / 电饭煲 / 炒锅 / 烤箱
- shoppingChannels：外卖 / 便利店 / 菜市场 / 超市 / 公司食堂
- preferredCuisines：川菜 / 粤菜 / 家常菜 / 轻食等
- dislikedIngredients：不爱吃的食材
- familiarFoods：用户常吃食物清单
- takeoutFrequency：工作日外卖频率
- diningContext：独居 / 家庭共餐 / 健身餐 / 办公室场景

这批字段比“高蛋白/低脂”更能决定用户会不会执行。

### P2-2. 在食物库里补“现实性标签”

现有食物库已经有部分基础字段，但还缺关键的执行性标签。

建议新增或强化：

- familiarityScore：家常程度 / 熟悉度
- channelAvailability：外卖 / 便利店 / 超市 / 食堂可获得性
- cuisineType：中式家常 / 轻食 / 日式 / 西式 / 健身餐
- dishType：成品菜 / 半成品 / 单食材 / 主食 / 配菜
- estimatedCostLevel：已存在可继续利用
- prepTimeMinutes：已存在可继续利用
- cookTimeMinutes：已存在可继续利用
- skillRequired：已存在可继续利用
- seasonality：季节性
- substituteGroup：可替代族群

例如：

- 鸡胸肉、水煮蛋、豆腐、番茄炒蛋、清炒时蔬、米饭
- 熟悉度高、渠道广、价格稳定

这类食物应该在默认推荐里天然占优。

### P2-3. 新增“现实执行分”并进入主排序

建议把推荐的主目标从：

- health score

升级为：

- final ranking = 营养得分 × 现实执行得分 × 个性偏好得分

现实执行得分建议由以下组成：

- familiarity：用户熟悉度
- availability：渠道可获得性
- affordability：预算匹配
- convenience：准备时间与技能门槛
- regionality：地区常见程度
- acceptance history：过去是否接受过

建议不是轻微加权，而是进入第一层排序目标。

否则系统还是会持续给出“营养好但没人真吃”的食物。

### P2-4. 把“硬约束”和“软偏好”分开

建议分层：

第一层，硬约束过滤：

- 预算不能超
- 购物渠道必须可获得
- 做法不能超过用户技能
- 准备时间不能超过当前时段允许值
- 过敏与健康禁忌必须排除

第二层，软排序：

- 营养最优
- 熟悉度更高
- 最近没吃过
- 用户反馈更好

现在系统的现实约束大多还停留在“轻微加权”，这不够。

### P2-5. 推荐内容从“食材”转向“家常方案”

用户真正执行的是方案，不是数据库字段。

建议默认输出从“若干高分食物”转成“可做、可买、可点”的组合方案：

- 公司午餐版：食堂可以这样选
- 外卖版：在外卖平台上大概率能点到
- 便利店版：7-11 / 罗森可拼出来
- 家常版：15 分钟能做完

同样满足蛋白和热量目标时，优先推荐：

- 番茄炒蛋 + 米饭 + 青菜
- 鸡胸肉便当 + 玉米 + 无糖酸奶
- 全麦三明治 + 茶叶蛋 + 牛奶

而不是默认推冷门或高度理想化食材组合。

### P2-6. 对冷门食材做“自动平替”

如果模型算出某个食材营养很好，但不常见，应自动映射到常见平替。

例如：

- 羽衣甘蓝 -> 生菜 / 菠菜 / 油麦菜
- 藜麦 -> 糙米 / 玉米 / 红薯
- 希腊酸奶 -> 无糖酸奶
- 三文鱼排 -> 鸡胸肉 / 鳕鱼 / 虾

这一步建议落在 substituteGroup 和 recommendation post-processing 上。

## 四、建议实施路径

## 阶段 1：一周内

目标：先把“分数可信”修好。

要做：

1. 修复 Web nutrition-score 接口契约不一致。
2. 修复 Web 计划一键记录漏写 avgQuality / avgSatiety / nutritionScore。
3. 修复小程序 analyze 保存漏写扩展营养字段。
4. DailySummary 缺失字段改为中性值，不再按 0 处理。
5. 加一个历史回填脚本重算近 30 到 90 天 summary。

验收标准：

1. 用户按推荐计划完成一天记录后，首页总分与详情评分方向一致。
2. 不再出现“宏量营养基本正常但总分异常偏低”的情况。

## 阶段 2：两周内

目标：让“推荐能执行”。

要做：

1. 用户画像补充预算、做饭能力、时间限制、购买渠道。
2. 食物库补 familiar、channel availability、dish type 等字段。
3. 引入 reality score，并进入默认排序。
4. 外卖/便利店/在家做三个场景改成硬过滤 + 软排序。

验收标准：

1. 推荐结果中常见家常食物占比显著提升。
2. 用户反馈里的“不想吃/太麻烦/买不到”比例明显下降。

## 阶段 3：三到四周内

目标：建立可持续优化闭环。

要做：

1. 收集用户对推荐的价格、方便度、是否买得到、是否常吃的反馈。
2. 训练 acceptance model，学习哪些推荐真正会被执行。
3. 推出“现实优先模式”作为默认推荐模式。

建议新增反馈项：

- 我愿意吃
- 太麻烦
- 买不到
- 太贵
- 不符合口味
- 下次少推荐类似的

## 五、我建议你现在优先落地的改动

如果要按投入产出比排序，建议优先级如下：

1. 先修记录链路漏字段，这是当前低分的主要 bug 来源。
2. 再统一首页和详情页评分口径，避免用户看到自相矛盾的结果。
3. 然后补“现实执行约束”到用户画像和食物库。
4. 最后再优化推荐排序，把 familiarity 和 availability 提到营养同级。

## 六、最终判断

当前问题不是“只有 bug”，也不是“只有推荐不完善”。

更准确地说：

- 评分偏低这件事，已经存在明确 bug，尤其是记录链路漏写质量分和饱腹感。
- 推荐不贴近现实这件事，属于当前系统目标函数不完整，现实执行性还没成为主目标。

所以正确做法不是只调公式，也不是只补食材库，而是按下面顺序推进：

1. 修数据链路
2. 统一评分口径
3. 加现实约束
4. 改推荐排序目标

只有这样，用户才会同时感受到：

- 分数可信
- 推荐能吃
- 计划能执行
- 系统真的懂自己




补充，是否需要贴近现实让用户档案选，然后推荐系统根据用户档案再定推荐策略