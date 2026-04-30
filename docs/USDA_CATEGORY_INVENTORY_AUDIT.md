# USDA 分类库存审计

更新时间：2026-04-30

## 结论

- 当前系统按实际导入口径（`Foundation + SR Legacy`）可抓取的 USDA 唯一食物总量是 **8188** 条。
- 这个数字不是直接取 USDA 某个分类接口的 `totalHits` 拼出来的，而是通过 **全量分页抓取 + 按 `fdcId` 去重** 得到的，可信度更高。
- 当前本地主库总食物数是 **1565** 条，其中 `primary_source = usda` 的食物是 **173** 条。
- 本地已导入的 USDA 数据覆盖仍然很低，按 USDA 原始分类看，大多数分类覆盖率都低于 **10%**。

## 为什么这份统计可信

### 采用的可信口径

对 USDA 可导入库存，采用的是下面这套方法：

1. 使用 `foods/search`
2. 固定导入口径：`dataType=Foundation,SR Legacy`
3. 使用 `query=*`
4. 全量分页拉取，`pageSize=200`
5. 一共拉取 **41** 页
6. 对所有结果按 `fdcId` 去重
7. 再按 USDA 原始 `foodCategory` 做精确计数

这套方法最终得到：

- `apiTotalHits = 8188`
- `uniqueFoods = 8188`

说明在这次审计里：

- USDA API 返回总量和全量去重后的唯一量一致
- 这份基线可以作为“当前系统实际可导入 USDA 库存”的可信盘点

### 明确不直接采用的口径

下面这种统计口径 **不可信，不建议用于决策**：

- 直接对每个分类请求 USDA `foods/search`
- 然后读取返回的 `totalHits`

原因：

- USDA 的 `foodCategory + dataType=Foundation,SR Legacy` 组合在部分分类下会返回可疑值
- 例如多个完全不同的分类会重复返回同一个 `totalHits = 4708`
- 这说明 USDA 后端的分类聚合计数在这个参数组合下并不稳定

所以本文件的核心盘点以“全量分页抓取后的真实去重结果”为准，而不是直接相信分类 `totalHits`。

## USDA 可导入库存总览

### 可导入总量（可信）

| 指标 | 数值 |
| --- | ---: |
| USDA 可导入唯一食物总量 | 8188 |
| 分页大小 | 200 |
| 抓取页数 | 41 |
| 数据类型口径 | Foundation + SR Legacy |

### 按 USDA 数据类型分布

| USDA 数据类型 | 数量 |
| --- | ---: |
| SR Legacy | 7793 |
| Foundation | 395 |

## 本地主库快照

### 本地主库总量

| 指标 | 数值 |
| --- | ---: |
| foods 总量 | 1565 |
| 其中 `primary_source = cn_food_composition` | 1247 |
| 其中 `primary_source = usda` | 173 |
| 其中 `primary_source = official` | 145 |

### 本地主库标准分类分布

| 标准分类 | 数量 |
| --- | ---: |
| protein | 663 |
| veggie | 355 |
| fruit | 169 |
| composite | 156 |
| grain | 105 |
| dairy | 87 |
| beverage | 15 |
| snack | 10 |
| fat | 5 |

## USDA 原始分类对照表

说明：

- `USDA 可导入量`：来自全量抓取 + `fdcId` 去重后的可信盘点
- `本地已导入 USDA`：本地 `food_sources.source_type = 'usda'`，按 `raw_data.foodCategory` 聚合
- `剩余未覆盖`：`USDA 可导入量 - 本地已导入 USDA`
- `覆盖率`：只反映“按原始 USDA 分类看，本地已导入了多少 USDA 项”，不等于中国主库的语义覆盖率

| USDA 原始分类 | USDA 可导入量 | 本地已导入 USDA | 剩余未覆盖 | 覆盖率 |
| --- | ---: | ---: | ---: | ---: |
| Beef Products | 969 | 2 | 967 | 0.21% |
| Vegetables and Vegetable Products | 903 | 0 | 903 | 0.00% |
| Baked Products | 523 | 3 | 520 | 0.57% |
| Lamb, Veal, and Game Products | 466 | 8 | 458 | 1.72% |
| Fruits and Fruit Juices | 411 | 0 | 411 | 0.00% |
| Poultry Products | 394 | 78 | 316 | 19.80% |
| Beverages | 369 | 0 | 369 | 0.00% |
| Sweets | 359 | 1 | 358 | 0.28% |
| Baby Foods | 345 | 20 | 325 | 5.80% |
| Pork Products | 343 | 2 | 341 | 0.58% |
| Dairy and Egg Products | 334 | 11 | 323 | 3.29% |
| Legumes and Legume Products | 332 | 7 | 325 | 2.11% |
| Fast Foods | 312 | 24 | 288 | 7.69% |
| Finfish and Shellfish Products | 288 | 1 | 287 | 0.35% |
| Soups, Sauces, and Gravies | 256 | 24 | 232 | 9.38% |
| Fats and Oils | 228 | 4 | 224 | 1.75% |
| Cereal Grains and Pasta | 224 | 1 | 223 | 0.45% |
| Breakfast Cereals | 195 | 1 | 194 | 0.51% |
| Sausages and Luncheon Meats | 181 | 21 | 160 | 11.60% |
| Snacks | 176 | 3 | 173 | 1.70% |
| American Indian/Alaska Native Foods | 165 | 4 | 161 | 2.42% |
| Nut and Seed Products | 156 | 0 | 156 | 0.00% |
| Restaurant Foods | 113 | 21 | 92 | 18.58% |
| Meals, Entrees, and Side Dishes | 81 | 8 | 73 | 9.88% |
| Spices and Herbs | 65 | 0 | 65 | 0.00% |

## 本地已导入 USDA 的原始分类分布

这是你当前库里已经落下来的 USDA 数据，按 USDA 原始分类看的分布：

| USDA 原始分类 | 本地已导入 USDA |
| --- | ---: |
| Poultry Products | 78 |
| Fast Foods | 24 |
| Soups, Sauces, and Gravies | 24 |
| Sausages and Luncheon Meats | 21 |
| Restaurant Foods | 21 |
| Baby Foods | 20 |
| Dairy and Egg Products | 11 |
| Meals, Entrees, and Side Dishes | 8 |
| Lamb, Veal, and Game Products | 8 |
| Legumes and Legume Products | 7 |
| American Indian/Alaska Native Foods | 4 |
| Fats and Oils | 4 |
| Snacks | 3 |
| Baked Products | 3 |
| Beef Products | 2 |
| Pork Products | 2 |
| Sweets | 1 |
| Cereal Grains and Pasta | 1 |
| Breakfast Cereals | 1 |
| Finfish and Shellfish Products | 1 |

## 如何解读这些数字

### 1. 你还没“接近导完” USDA

如果只看当前系统实际可导入口径：

- USDA 可导入唯一项：8188
- 本地 USDA 已导入：173

这意味着你现在更像是“刚开始补 USDA”，而不是“已经差不多导完了”。

### 2. 中国主库和 USDA 不是简单相减关系

不能直接用：

- `8188 - 1565`

来理解“还差多少”。

因为：

- 中国主库很多是中文主数据，不一定有 USDA source 记录
- 很多 USDA 项其实会命中现有中国主库，然后只做补缺，不会新增一条食物
- 所以“剩余未覆盖”更准确的含义是：
  - 还没以 USDA source 形式落库/关联过的 USDA 项规模

### 3. 哪些分类最值得优先补

从“量大 + 当前 USDA 覆盖低”这两个维度看，优先级建议：

1. `Vegetables and Vegetable Products`
2. `Beef Products`
3. `Fruits and Fruit Juices`
4. `Baked Products`
5. `Pork Products`
6. `Legumes and Legume Products`
7. `Dairy and Egg Products`
8. `Finfish and Shellfish Products`
9. `Cereal Grains and Pasta`
10. `Nut and Seed Products`

### 4. 哪些分类已经相对导得更多

虽然总量仍不高，但相对其他分类来说，下面这些你已经导得更多一些：

- `Poultry Products`（19.80%）
- `Restaurant Foods`（18.58%）
- `Sausages and Luncheon Meats`（11.60%）
- `Meals, Entrees, and Side Dishes`（9.88%）
- `Soups, Sauces, and Gravies`（9.38%）
- `Fast Foods`（7.69%）

## 使用建议

### 推荐导入模式

如果你的主库仍然是中国食物库为主，建议 USDA 分类导入继续使用：

- `fill_missing_only`

原因：

- 新食物可以补进来
- 已命中的中国主库条目只补空字段
- 不会因为重复跑分类而大量新增冲突

### 推荐导入顺序

建议优先按下面顺序补：

1. 蔬菜
2. 水果
3. 牛肉 / 猪肉 / 海鲜
4. 豆类
5. 乳制品
6. 谷物与坚果

### 操作策略

建议：

1. 先用分类预估
2. 再小批量分页导入
3. 看命中更新/跳过比例
4. 确认效果正常后再扩大页数或页大小

不建议：

- 对覆盖率已经偏高的分类反复整包重跑
- 把 USDA 官方分类总量直接当成本地主库还缺多少条的精确数字

## 本次审计中发现的接口问题

### 已确认问题

- USDA 的 `foodCategory` 对 `American Indian/Alaska Native Foods` 原始值兼容有问题
- 直接传原值会返回 `400/500`

### 已修复兼容

系统已对这个分类值做兼容处理：

- `American Indian/Alaska Native Foods`
- 会按 USDA 可接受的方式转换后再请求

因此该分类现在已经可以正常导入。
