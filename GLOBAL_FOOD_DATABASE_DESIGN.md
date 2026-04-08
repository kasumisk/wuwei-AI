# 全球化食物数据库系统设计方案

> 版本: v1.0 | 日期: 2026-04-08 | 基于 wuwei-AI 现有系统架构

---

## 目录

1. [现状分析](#1-现状分析)
2. [数据结构优化设计](#2-数据结构优化设计)
3. [数据来源方案](#3-数据来源方案)
4. [数据加工与标准化 Pipeline](#4-数据加工与标准化-pipeline)
5. [AI 辅助标注方案](#5-ai-辅助标注方案)
6. [本地 AI 实施方案](#6-本地-ai-实施方案)
7. [实施路线图](#7-实施路线图)

---

## 1. 现状分析

### 1.1 当前 food_library 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| name | varchar(100) | 食物名称（唯一） |
| aliases | varchar(300) | 别名，逗号分隔 |
| category | varchar(50) | 食物分类：主食/肉类/蔬菜/水果/豆制品/汤类/饮品/零食/快餐/调味料 |
| calories_per_100g | int | 每100g热量 kcal |
| protein_per_100g | decimal(5,1) | 蛋白质 g/100g |
| fat_per_100g | decimal(5,1) | 脂肪 g/100g |
| carbs_per_100g | decimal(5,1) | 碳水 g/100g |
| fiber_per_100g | decimal(5,1) | 膳食纤维 g/100g |
| sugar_per_100g | decimal(5,1) | 糖 g/100g |
| sodium_per_100g | decimal(6,1) | 钠 mg/100g |
| glycemic_index | int | GI值 |
| is_processed | boolean | 是否加工食品 |
| is_fried | boolean | 是否油炸 |
| meal_types | jsonb | 适合餐次 |
| main_ingredient | varchar(50) | 主要食材 |
| sub_category | varchar(50) | 子分类 |
| quality_score | int | 食物品质评分 1-10 |
| satiety_score | int | 饱腹感评分 1-10 |
| standard_serving_g | int | 标准份量克数 |
| standard_serving_desc | varchar(50) | 份量描述 |
| search_weight | int | 搜索排序权重 |
| is_verified | boolean | 是否已审核 |
| tags | jsonb | 标签 |
| source | varchar(20) | 数据来源: official/estimated/ai |
| confidence | decimal(3,2) | 营养数据置信度 0-1 |

### 1.2 当前存在的问题

| 问题 | 影响 |
|------|------|
| **无国际化支持** | 只能存中文名，无法支持多语言 App |
| **单一数据来源记录** | 只有 source 字段，无法记录多数据源的具体细节 |
| **无版本控制** | 数据被覆盖后无法回溯 |
| **无冲突处理机制** | 多来源数据不一致时无标准处理流程 |
| **分类系统硬编码** | 分类用中文枚举，无法国际化 |
| **搭配关系缺失** | 无 goodWith/badWith，无法生成高质量套餐 |
| **多样性控制不足** | 只有 mainIngredient，缺少 diversityGroup |
| **微量营养素缺失** | 缺少维生素、矿物质等微量营养素 |
| **食物图片缺失** | 无 imageUrl，App 展示效果差 |
| **条形码缺失** | 无法对接包装食品扫码识别场景 |

---

## 2. 数据结构优化设计

### 2.1 核心设计原则

1. **国际化优先** — 名称、描述、分类全部支持多语言
2. **多来源融合** — 每个字段可追溯数据来源
3. **AI 可标注** — 结构支持自动标注 + 人工校验
4. **版本可控** — 数据变更有审计记录
5. **向后兼容** — 新结构兼容现有 food_records、daily_plans 等引用

### 2.2 升级后数据库 Schema（分表设计）

#### 2.2.1 主表 `foods`（食物核心表）

```sql
CREATE TABLE foods (
  -- ═══ 基础标识 ═══
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(50) UNIQUE NOT NULL,      -- 全局唯一编码: "FOOD_CN_001"
  barcode         VARCHAR(50),                       -- EAN-13 / UPC 条形码
  status          VARCHAR(20) DEFAULT 'draft',       -- draft | active | archived | merged
  
  -- ═══ 标准化分类 ═══
  category        VARCHAR(30) NOT NULL,              -- 一级分类: protein / carbs / fat / veggie / fruit / dairy / grain / beverage / snack / seasoning
  sub_category    VARCHAR(50),                       -- 二级分类: lean_meat / whole_grain / leafy_veg / root_veg ...
  food_group      VARCHAR(30),                       -- 多样性分组: meat / poultry / seafood / legume ...
  
  -- ═══ 宏量营养素 (per 100g) ═══
  calories        DECIMAL(7,1) NOT NULL,             -- 热量 kcal
  protein         DECIMAL(6,1),                      -- 蛋白质 g
  fat             DECIMAL(6,1),                      -- 脂肪 g
  carbs           DECIMAL(6,1),                      -- 碳水化合物 g
  fiber           DECIMAL(5,1),                      -- 膳食纤维 g
  sugar           DECIMAL(5,1),                      -- 糖 g
  saturated_fat   DECIMAL(5,1),                      -- 饱和脂肪 g
  trans_fat       DECIMAL(5,2),                      -- 反式脂肪 g
  cholesterol     DECIMAL(6,1),                      -- 胆固醇 mg
  
  -- ═══ 微量营养素 (per 100g) ═══
  sodium          DECIMAL(7,1),                      -- 钠 mg
  potassium       DECIMAL(7,1),                      -- 钾 mg
  calcium         DECIMAL(7,1),                      -- 钙 mg
  iron            DECIMAL(5,2),                      -- 铁 mg
  vitamin_a       DECIMAL(7,1),                      -- 维生素A μg RAE
  vitamin_c       DECIMAL(6,1),                      -- 维生素C mg
  vitamin_d       DECIMAL(5,2),                      -- 维生素D μg
  vitamin_e       DECIMAL(5,2),                      -- 维生素E mg
  vitamin_b12     DECIMAL(5,2),                      -- 维生素B12 μg
  folate          DECIMAL(6,1),                      -- 叶酸 μg
  zinc            DECIMAL(5,2),                      -- 锌 mg
  magnesium       DECIMAL(6,1),                      -- 镁 mg
  
  -- ═══ 健康评估 ═══
  glycemic_index  INT,                               -- GI值 0-100
  glycemic_load   DECIMAL(5,1),                      -- GL值
  is_processed    BOOLEAN DEFAULT false,
  is_fried        BOOLEAN DEFAULT false,
  processing_level INT DEFAULT 1,                    -- NOVA分级 1-4 (1=天然, 4=超加工)
  allergens       JSONB DEFAULT '[]',                -- 过敏原: ["gluten","dairy","nuts","soy","egg","shellfish"]
  
  -- ═══ 决策引擎字段 ═══
  quality_score   DECIMAL(3,1),                      -- 食物品质评分 1-10
  satiety_score   DECIMAL(3,1),                      -- 饱腹感评分 1-10
  nutrient_density DECIMAL(5,1),                     -- 营养密度评分 (NRF 9.3 算法)
  meal_types      JSONB DEFAULT '[]',                -- ["breakfast","lunch","dinner","snack"]
  tags            JSONB DEFAULT '[]',                -- ["high_protein","low_fat","keto","vegan"]
  
  -- ═══ 多样性 & 搭配 ═══
  main_ingredient VARCHAR(50),                       -- 主原料: chicken / rice / tofu
  compatibility   JSONB DEFAULT '{}',                -- {"goodWith": ["rice","broccoli"], "badWith": ["cola"]}
  
  -- ═══ 份量系统 ═══
  standard_serving_g   INT DEFAULT 100,
  standard_serving_desc VARCHAR(100),                -- "1碗约200g" / "1片约30g"
  common_portions JSONB DEFAULT '[]',                -- [{"name":"1碗","grams":200},{"name":"1片","grams":30}]
  
  -- ═══ 媒体 ═══
  image_url       VARCHAR(500),                      -- 食物图片
  thumbnail_url   VARCHAR(500),                      -- 缩略图
  
  -- ═══ 数据溯源 ═══
  primary_source       VARCHAR(50) DEFAULT 'manual', -- usda / openfoodfacts / ai / manual / crawl
  primary_source_id    VARCHAR(100),                 -- 原始来源中的ID
  data_version         INT DEFAULT 1,                -- 数据版本号
  confidence           DECIMAL(3,2) DEFAULT 1.0,     -- 综合置信度 0-1
  is_verified          BOOLEAN DEFAULT false,
  verified_by          VARCHAR(100),                 -- 审核人
  verified_at          TIMESTAMP,
  
  -- ═══ 搜索优化 ═══
  search_weight   INT DEFAULT 100,
  popularity      INT DEFAULT 0,                     -- 用户使用次数统计
  
  -- ═══ 时间戳 ═══
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_foods_code ON foods(code);
CREATE INDEX idx_foods_category ON foods(category);
CREATE INDEX idx_foods_barcode ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_foods_search_weight ON foods(search_weight DESC);
CREATE INDEX idx_foods_status ON foods(status);
CREATE INDEX idx_foods_primary_source ON foods(primary_source);
CREATE INDEX idx_foods_tags ON foods USING GIN(tags);
CREATE INDEX idx_foods_meal_types ON foods USING GIN(meal_types);
```

#### 2.2.2 国际化翻译表 `food_translations`

```sql
CREATE TABLE food_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id     UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  locale      VARCHAR(10) NOT NULL,      -- zh-CN / zh-TW / en-US / ja-JP / ko-KR
  name        VARCHAR(200) NOT NULL,     -- 当地语言名称
  aliases     TEXT,                       -- 别名，逗号分隔
  description TEXT,                       -- 食物描述
  serving_desc VARCHAR(100),             -- 本地化份量描述
  
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(food_id, locale)
);

CREATE INDEX idx_food_trans_locale ON food_translations(locale);
CREATE INDEX idx_food_trans_name ON food_translations(name);
```

#### 2.2.3 多数据源表 `food_sources`

```sql
CREATE TABLE food_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id         UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  source_type     VARCHAR(50) NOT NULL,    -- usda / openfoodfacts / edamam / crawl_meituan / ai_deepseek
  source_id       VARCHAR(200),            -- 该来源中的原始ID
  source_url      VARCHAR(500),            -- 原始数据URL
  
  -- 该来源的营养数据快照
  raw_data        JSONB NOT NULL,          -- 原始数据完整保存
  mapped_data     JSONB,                   -- 映射到标准字段后的数据
  
  confidence      DECIMAL(3,2) DEFAULT 0.8,
  is_primary      BOOLEAN DEFAULT false,   -- 是否为主数据源
  priority        INT DEFAULT 50,          -- 来源优先级 1-100
  
  fetched_at      TIMESTAMP DEFAULT NOW(), -- 抓取时间
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_food_sources_food ON food_sources(food_id);
CREATE INDEX idx_food_sources_type ON food_sources(source_type);
```

#### 2.2.4 数据变更日志表 `food_change_logs`

```sql
CREATE TABLE food_change_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id     UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  action      VARCHAR(20) NOT NULL,       -- create / update / merge / verify / archive
  changes     JSONB NOT NULL,             -- {"field": {"old": x, "new": y}}
  reason      TEXT,                        -- 变更原因
  operator    VARCHAR(100),               -- 操作人: admin / ai_pipeline / usda_sync
  
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_food_changelog_food ON food_change_logs(food_id, version);
```

#### 2.2.5 食物冲突表 `food_conflicts`

```sql
CREATE TABLE food_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id         UUID NOT NULL REFERENCES foods(id),
  field           VARCHAR(50) NOT NULL,    -- 冲突字段: calories / protein / category ...
  sources         JSONB NOT NULL,          -- [{"source":"usda","value":165},{"source":"off","value":170}]
  resolution      VARCHAR(20),             -- pending / auto_highest_priority / manual / averaged
  resolved_value  TEXT,                    -- 最终采用的值
  resolved_by     VARCHAR(100),
  resolved_at     TIMESTAMP,
  
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_food_conflicts_food ON food_conflicts(food_id);
CREATE INDEX idx_food_conflicts_status ON food_conflicts(resolution);
```

#### 2.2.6 地区适配表 `food_regional_info`

```sql
CREATE TABLE food_regional_info (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id     UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  region      VARCHAR(10) NOT NULL,       -- CN / US / JP / KR / EU
  
  -- 地区特有信息
  local_popularity INT DEFAULT 0,          -- 该地区流行度
  local_price_range VARCHAR(20),           -- 价格区间: low / medium / high
  availability     VARCHAR(20),            -- 可获得性: common / seasonal / rare
  regulatory_info  JSONB,                  -- 监管信息（如中国食品安全标准编号）
  
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(food_id, region)
);
```

### 2.3 完整字段说明

#### 基础标识层

| 字段 | 类型 | 必须 | 说明 |
|------|------|:----:|------|
| `id` | UUID | ✅ | 主键，自动生成 |
| `code` | VARCHAR(50) | ✅ | 全局唯一编码，格式 `FOOD_{region}_{seq}`，如 `FOOD_CN_0001` |
| `barcode` | VARCHAR(50) | ❌ | 商品条形码（EAN-13/UPC），用于扫码识别 |
| `status` | VARCHAR(20) | ✅ | 生命周期状态：draft→active→archived/merged |

#### 标准化分类层

| 字段 | 类型 | 必须 | 说明 |
|------|------|:----:|------|
| `category` | VARCHAR(30) | ✅ | 一级分类，使用英文编码，全球统一 |
| `sub_category` | VARCHAR(50) | ❌ | 二级分类，更精细的分类 |
| `food_group` | VARCHAR(30) | ❌ | 多样性分组，用于避免连续推荐同类食材 |

**一级分类 category 标准码表：**

| Code | 中文 | 英文 | 说明 |
|------|------|------|------|
| `protein` | 蛋白质类 | Protein | 肉/蛋/鱼/豆制品 |
| `grain` | 谷物主食 | Grains | 米/面/面包/薯类 |
| `veggie` | 蔬菜 | Vegetables | 叶菜/根茎/菌菇 |
| `fruit` | 水果 | Fruits | 各类水果 |
| `dairy` | 乳制品 | Dairy | 牛奶/酸奶/奶酪 |
| `fat` | 油脂坚果 | Fats & Nuts | 食用油/坚果/种子 |
| `beverage` | 饮品 | Beverages | 茶/咖啡/果汁 |
| `snack` | 零食甜点 | Snacks | 饼干/糖果/甜品 |
| `condiment` | 调味料 | Condiments | 酱油/醋/酱料 |
| `composite` | 复合菜肴 | Composite | 炒菜/汤/便当 |

**二级分类 sub_category 示例：**

| Category | sub_category 值 |
|----------|-----------------|
| protein | `lean_meat` / `fatty_meat` / `poultry` / `fish` / `shellfish` / `egg` / `tofu` / `legume` |
| grain | `white_rice` / `brown_rice` / `noodle` / `bread` / `potato` / `corn` / `oat` |
| veggie | `leafy_green` / `cruciferous` / `root` / `mushroom` / `sea_veg` / `sprout` |
| fruit | `citrus` / `berry` / `tropical` / `stone_fruit` / `melon` / `dried` |

#### 宏量营养素层

| 字段 | 类型 | 必须 | 单位 | 说明 |
|------|------|:----:|------|------|
| `calories` | DECIMAL(7,1) | ✅ | kcal/100g | 热量，核心字段 |
| `protein` | DECIMAL(6,1) | ❌ | g/100g | 蛋白质 |
| `fat` | DECIMAL(6,1) | ❌ | g/100g | 总脂肪 |
| `carbs` | DECIMAL(6,1) | ❌ | g/100g | 总碳水化合物 |
| `fiber` | DECIMAL(5,1) | ❌ | g/100g | 膳食纤维（饱腹感核心） |
| `sugar` | DECIMAL(5,1) | ❌ | g/100g | 糖（控糖用户关键） |
| `saturated_fat` | DECIMAL(5,1) | ❌ | g/100g | 饱和脂肪 |
| `trans_fat` | DECIMAL(5,2) | ❌ | g/100g | 反式脂肪 |
| `cholesterol` | DECIMAL(6,1) | ❌ | mg/100g | 胆固醇 |

#### 微量营养素层

| 字段 | 类型 | 必须 | 单位 | 说明 |
|------|------|:----:|------|------|
| `sodium` | DECIMAL(7,1) | ❌ | mg/100g | 钠 |
| `potassium` | DECIMAL(7,1) | ❌ | mg/100g | 钾 |
| `calcium` | DECIMAL(7,1) | ❌ | mg/100g | 钙 |
| `iron` | DECIMAL(5,2) | ❌ | mg/100g | 铁 |
| `vitamin_a` | DECIMAL(7,1) | ❌ | μg RAE/100g | 维生素A |
| `vitamin_c` | DECIMAL(6,1) | ❌ | mg/100g | 维生素C |
| `vitamin_d` | DECIMAL(5,2) | ❌ | μg/100g | 维生素D |
| `vitamin_e` | DECIMAL(5,2) | ❌ | mg/100g | 维生素E |
| `vitamin_b12` | DECIMAL(5,2) | ❌ | μg/100g | 维生素B12 |
| `folate` | DECIMAL(6,1) | ❌ | μg/100g | 叶酸 |
| `zinc` | DECIMAL(5,2) | ❌ | mg/100g | 锌 |
| `magnesium` | DECIMAL(6,1) | ❌ | mg/100g | 镁 |

#### 健康评估层

| 字段 | 类型 | 必须 | 说明 |
|------|------|:----:|------|
| `glycemic_index` | INT | ❌ | GI值 0-100，低GI≤55，中GI 56-69，高GI≥70 |
| `glycemic_load` | DECIMAL(5,1) | ❌ | GL值 = GI × 碳水含量 / 100 |
| `is_processed` | BOOLEAN | ✅ | 是否加工食品 |
| `is_fried` | BOOLEAN | ✅ | 是否油炸 |
| `processing_level` | INT | ❌ | NOVA分级：1=天然未加工, 2=加工原料, 3=加工食品, 4=超加工食品 |
| `allergens` | JSONB | ❌ | 过敏原标签数组 |

#### 决策引擎层

| 字段 | 类型 | 必须 | 说明 |
|------|------|:----:|------|
| `quality_score` | DECIMAL(3,1) | ❌ | 食物品质评分 1-10，综合营养密度、加工程度 |
| `satiety_score` | DECIMAL(3,1) | ❌ | 饱腹感评分 1-10，综合 fiber、protein、water content |
| `nutrient_density` | DECIMAL(5,1) | ❌ | NRF 9.3 营养密度评分 |
| `meal_types` | JSONB | ❌ | 适合餐次数组 |
| `tags` | JSONB | ❌ | 推荐标签数组 |
| `compatibility` | JSONB | ❌ | 搭配关系 |
| `main_ingredient` | VARCHAR(50) | ❌ | 主原料，用于多样性控制 |

#### 数据溯源层

| 字段 | 类型 | 必须 | 说明 |
|------|------|:----:|------|
| `primary_source` | VARCHAR(50) | ✅ | 主数据来源标识 |
| `primary_source_id` | VARCHAR(100) | ❌ | 来源原始ID |
| `data_version` | INT | ✅ | 每次更新版本号+1 |
| `confidence` | DECIMAL(3,2) | ✅ | 综合置信度，多来源加权 |
| `is_verified` | BOOLEAN | ✅ | 人工审核状态 |
| `verified_by` | VARCHAR(100) | ❌ | 审核人 |
| `verified_at` | TIMESTAMP | ❌ | 审核时间 |

### 2.4 标签体系标准码表

```
# 营养特征标签
high_protein     — 蛋白质 ≥ 20g/100g
low_fat          — 脂肪 ≤ 3g/100g
low_carb         — 碳水 ≤ 5g/100g
high_fiber       — 膳食纤维 ≥ 6g/100g
low_calorie      — 热量 ≤ 100kcal/100g
low_sodium       — 钠 ≤ 120mg/100g
low_sugar        — 糖 ≤ 5g/100g
low_gi           — GI ≤ 55

# 目标适配标签
weight_loss      — 适合减肥
muscle_gain      — 适合增肌
keto             — 适合生酮饮食
vegan            — 纯素食
vegetarian       — 素食（含蛋奶）
gluten_free      — 无麸质
diabetes_friendly — 适合糖尿病
heart_healthy    — 有益心血管

# 属性标签
natural          — 天然未加工
organic          — 有机
whole_food       — 全食物
quick_prep       — 快速制备（≤10分钟）
meal_prep_friendly — 适合提前备餐
budget_friendly  — 经济实惠
```

### 2.5 quality_score 计算算法

```
quality_score = (
  protein_density × 2.0      // 蛋白质密度（protein / calories × 100）
  + fiber_bonus × 1.5        // 纤维奖励（fiber > 3 ? min(fiber/3, 2) : 0）
  - processed_penalty × 2.0  // 加工惩罚（NOVA 3=1, NOVA 4=2）
  - fried_penalty × 1.5      // 油炸惩罚（is_fried ? 1.5 : 0）
  - sugar_penalty × 1.0      // 高糖惩罚（sugar > 10 ? min(sugar/10, 2) : 0）
  - trans_fat_penalty × 3.0  // 反式脂肪惩罚（trans_fat > 0 ? 3 : 0）
  + micronutrient_bonus       // 微量营养素奖励 0-2
)
// 最终归一化到 1-10
```

### 2.6 satiety_score 计算算法

```
satiety_score = (
  protein_factor × 3.0       // 蛋白质因子（protein / 10, 上限3）
  + fiber_factor × 2.5       // 纤维因子（fiber / 5, 上限2.5）
  + water_factor × 1.5       // 含水量因子（estimated from calories density）
  - fat_factor × 1.0         // 高脂肪降低饱腹感
  - gi_factor × 1.0          // 高GI降低持久饱腹感
)
// 最终归一化到 1-10
```

---

## 3. 数据来源方案

### 3.1 数据来源对比表

| 来源 | 数据类型 | 覆盖范围 | 数据质量 | 商用许可 | 法律风险 | 需清洗 | 建议 |
|------|---------|---------|---------|---------|---------|:------:|------|
| **USDA FoodData Central** | 宏量+微量营养素、食物分类 | 美国食物为主，9000+ 基础食物 | ⭐⭐⭐⭐⭐ | ✅ 公共领域 | 无 | 低 | **主数据源** |
| **Open Food Facts** | 条形码、成分表、NOVA分级、Nutri-Score | 全球 300万+ 产品 | ⭐⭐⭐ | ✅ ODbL | 无 | 中 | **辅助来源** |
| **中国食物成分表** | 中国食物宏量營养素 | 中国食物 2000+ | ⭐⭐⭐⭐⭐ | ⚠️ 出版物，需授权 | 低 | 低 | **中国区主数据源** |
| **Edamam API** | 营养数据、食谱分析 | 全球 90万+ | ⭐⭐⭐⭐ | ⚠️ 按调用收费 | 无 | 低 | 补充来源 |
| **Nutritionix API** | 商品化食物+餐厅菜品 | 美国为主 | ⭐⭐⭐⭐ | ⚠️ 商业授权 | 无 | 低 | 餐厅场景补充 |
| **FatSecret API** | 营养数据+品牌 | 全球 | ⭐⭐⭐ | ⚠️ 免费有限额 | 无 | 中 | 备选 |
| **美团/饿了么爬虫** | 中国外卖菜品名+价格 | 中国外卖平台 | ⭐⭐ | ❌ 违反TOS | **高** | 高 | **不建议** |
| **下厨房/菜谱网站** | 菜谱+食材+做法 | 中国家常菜 | ⭐⭐ | ⚠️ 版权风险 | 中 | 高 | 辅助参考 |
| **AI 生成 (DeepSeek/GPT)** | 估算营养数据、标签、分类 | 任意 | ⭐⭐⭐ | ✅ | 无 | 需校验 | AI 标注辅助 |

### 3.2 推荐组合方案

```
┌─────────────────────────────────────────────────────┐
│                 数据来源分层架构                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  第一层 · 权威基础层 (confidence: 0.95-1.0)          │
│  ┌──────────────┐  ┌──────────────────┐            │
│  │ USDA FoodData │  │ 中国食物成分表     │            │
│  │ Central       │  │ (人工录入或授权)    │            │
│  └──────────────┘  └──────────────────┘            │
│                                                     │
│  第二层 · 开源补充层 (confidence: 0.75-0.90)          │
│  ┌──────────────────────────────────────┐           │
│  │ Open Food Facts (条形码+NOVA+产品数据) │           │
│  └──────────────────────────────────────┘           │
│                                                     │
│  第三层 · AI 标注层 (confidence: 0.60-0.80)           │
│  ┌──────────────────────────────────────┐           │
│  │ DeepSeek/GPT (分类/标签/估算/翻译)     │           │
│  └──────────────────────────────────────┘           │
│                                                     │
│  第四层 · 商业 API 层 (按需)                          │
│  ┌──────────────┐  ┌─────────────────┐             │
│  │ Edamam API   │  │ Nutritionix API │             │
│  └──────────────┘  └─────────────────┘             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**推荐初期方案（MVP）：**
- **主数据源**: USDA + 中国食物成分表（人工录入Top 500常见中国食物）
- **AI 辅助**: DeepSeek 批量生成 tags / category / quality_score / satiety_score
- **条形码**: Open Food Facts 对接
- **扩展预留**: Edamam 接口备用

### 3.3 各数据源接入规格

#### USDA FoodData Central

```
API Endpoint: https://api.nal.usda.gov/fdc/v1/
API Key: 免费申请 (https://fdc.nal.usda.gov/api-key-signup.html)
Rate Limit: 1000 requests/hour (免费)
格式: JSON
License: Public Domain (无版权限制)

关键接口:
  GET /foods/search?query={keyword}       — 搜索食物
  GET /food/{fdcId}                       — 获取食物详情
  GET /foods?fdcIds={id1,id2}             — 批量获取

字段映射:
  fdcId           → primary_source_id
  description     → food_translations[en-US].name
  foodCategory    → category (需映射)
  foodNutrients[] → calories, protein, fat, carbs, ...
    nutrientId=1008 → calories (Energy)
    nutrientId=1003 → protein
    nutrientId=1004 → fat
    nutrientId=1005 → carbs
    nutrientId=1079 → fiber
    nutrientId=2000 → sugar
    nutrientId=1093 → sodium
    nutrientId=1092 → potassium
    nutrientId=1087 → calcium
    nutrientId=1089 → iron
```

#### Open Food Facts

```
API Endpoint: https://world.openfoodfacts.org/api/v2/
Rate Limit: 无硬性限制 (建议 < 100 req/min)
格式: JSON
License: ODbL (开放数据库许可)

关键接口:
  GET /product/{barcode}                  — 条形码查询
  GET /cgi/search.pl?search_terms={kw}    — 搜索

字段映射:
  code                    → barcode
  product_name            → food_translations[locale].name
  nova_group              → processing_level
  nutriscore_grade        → (可参考辅助 quality_score)
  nutriments.energy-kcal_100g  → calories
  nutriments.proteins_100g     → protein
  nutriments.fat_100g          → fat
  nutriments.carbohydrates_100g → carbs
  allergens_tags          → allergens
```

---

## 4. 数据加工与标准化 Pipeline

### 4.1 Pipeline 流程图

```
┌──────────────────────────────────────────────────────────────────┐
│                        数据加工 Pipeline                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ 1.采集    │───▶│ 2.清洗    │───▶│ 3.标准化  │───▶│ 4.去重    │  │
│  │ Ingest   │    │ Clean    │    │ Normalize│    │ Dedup    │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │                                                │         │
│       │          ┌──────────┐    ┌──────────┐         │         │
│       │          │ 7.入库    │◀───│ 6.校验    │◀────────┘         │
│       │          │ Persist  │    │ Validate │                   │
│       │          └──────────┘    └──────────┘                   │
│       │                              ▲                          │
│       │                         ┌──────────┐                    │
│       └─ (条形码扫描/手动录入) ──▶│ 5.AI标注  │                    │
│                                 │ AI Label │                    │
│                                 └──────────┘                    │
│                                                                  │
│  ┌──────────┐                   ┌──────────┐                    │
│  │ 8.冲突    │                   │ 9.翻译    │                    │
│  │ Conflict │                   │ Translate│                    │
│  └──────────┘                   └──────────┘                    │
│       ↑ (异步后处理)                  ↑ (异步后处理)               │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Step 1: 数据采集 (Ingest)

**实现方式：NestJS 调度任务 + 独立 Script**

```typescript
// 采集器接口定义
interface FoodDataFetcher {
  sourceType: string;
  
  /** 搜索食物 */
  search(query: string, locale?: string): Promise<RawFoodData[]>;
  
  /** 按ID获取 */
  getById(sourceId: string): Promise<RawFoodData | null>;
  
  /** 批量同步 (全量/增量) */
  sync(options: { since?: Date; limit?: number }): AsyncGenerator<RawFoodData>;
}

// 原始数据统一格式
interface RawFoodData {
  sourceType: string;
  sourceId: string;
  sourceUrl?: string;
  rawPayload: Record<string, any>;  // 保存原始JSON
  fetchedAt: Date;
}
```

**采集策略：**

| 来源 | 采集方式 | 频率 | 触发条件 |
|------|---------|------|---------|
| USDA | API 批量拉取 | 每月全量同步 | 定时任务 |
| Open Food Facts | API 按需查询 | 用户扫码触发 | 实时 |
| 中国食物成分表 | CSV/Excel 人工导入 | 一次性 + 版本更新 | 手动 |
| AI 生成 | 按需调用 | 缺失数据时触发 | 异步任务 |

### 4.3 Step 2: 数据清洗 (Clean)

```typescript
interface CleaningRules {
  // 1. 空值处理
  removeNullCalories: true;          // 没有热量数据的丢弃
  
  // 2. 异常值检测
  caloriesRange: [0, 900];           // kcal/100g 合理范围
  proteinRange: [0, 100];            // g/100g
  fatRange: [0, 100];
  carbsRange: [0, 100];
  
  // 3. 宏量营养素交叉验证
  // calories ≈ protein×4 + carbs×4 + fat×9 (±15% 误差容忍)
  macroValidation: {
    tolerance: 0.15,
    action: 'flag_for_review'        // flag_for_review | auto_recalc | reject
  };
  
  // 4. 文本清洗
  trimWhitespace: true;
  removeHTML: true;
  normalizeUnicode: true;            // 全角→半角
  
  // 5. 单位统一
  convertKjToKcal: true;             // kJ → kcal (÷4.184)
  convertMgToG: false;               // 保持mg
  standardizeTo100g: true;           // 统一到 per 100g
}
```

**宏量营养素交叉验证公式：**

$$Calories_{expected} = Protein \times 4 + Carbs \times 4 + Fat \times 9 + Fiber \times 2$$

$$Error = \frac{|Calories_{actual} - Calories_{expected}|}{Calories_{actual}}$$

如果 $Error > 15\%$，标记为需要人工审核。

### 4.4 Step 3: 标准化 (Normalize)

```typescript
// 分类映射表
const CATEGORY_MAPPING: Record<string, Record<string, string>> = {
  usda: {
    'Beef Products': 'protein',
    'Poultry Products': 'protein',
    'Finfish and Shellfish Products': 'protein',
    'Vegetables and Vegetable Products': 'veggie',
    'Fruits and Fruit Juices': 'fruit',
    'Cereal Grains and Pasta': 'grain',
    'Dairy and Egg Products': 'dairy',
    'Beverages': 'beverage',
    'Snacks': 'snack',
    'Spices and Herbs': 'condiment',
    // ...完整映射
  },
  openfoodfacts: {
    'en:meats': 'protein',
    'en:vegetables': 'veggie',
    'en:fruits': 'fruit',
    'en:cereals-and-potatoes': 'grain',
    'en:dairies': 'dairy',
    // ...
  },
  chinese: {
    '谷薯类': 'grain',
    '蔬菜类': 'veggie',
    '水果类': 'fruit',
    '畜肉类': 'protein',
    '禽肉类': 'protein',
    '鱼虾蟹贝类': 'protein',
    '蛋类': 'protein',
    '乳类': 'dairy',
    '豆类': 'protein',
    '坚果类': 'fat',
    // ...
  }
};

// 字段映射策略
interface FieldMapping {
  source: string;            // 原始字段路径 (支持 JSONPath)
  target: string;            // 目标字段名
  transform?: (val: any) => any;  // 转换函数
  unit?: { from: string; to: string; factor: number };
}
```

### 4.5 Step 4: 去重 (Dedup)

**去重策略优先级：**

```
1. 精确匹配：barcode (EAN-13) 相同 → 100% 同一产品
2. 来源ID匹配：source_type + source_id 相同 → 更新而非新增
3. 名称模糊匹配：
   a. 标准化名称（去空格、繁简转换、英文小写化）
   b. 计算相似度：Levenshtein + Jaccard + 拼音匹配
   c. 阈值：相似度 > 0.85 → 候选重复
4. 营养数据辅助：
   a. 名称相似 + 热量差异 < 10% → 高度疑似重复
   b. 同分类 + 蛋白质/脂肪/碳水差异均 < 20% → 疑似重复
5. 人工确认：
   a. 自动合并：precision > 0.95 的重复
   b. 人工审核：0.85 < precision < 0.95 的候选
```

**去重合并规则：**

```typescript
function mergeFoodData(existing: Food, incoming: RawFoodData, sourceConfig: SourceConfig): Food {
  // 1. 保留高优先级来源的数据
  if (sourceConfig.priority > existing.sourcePriority) {
    // 更新营养数据
    existing.calories = incoming.calories ?? existing.calories;
    // ...
  }
  
  // 2. 补充缺失字段（不覆盖已有数据）
  existing.barcode = existing.barcode ?? incoming.barcode;
  existing.glycemicIndex = existing.glycemicIndex ?? incoming.glycemicIndex;
  
  // 3. 合并数组字段（去重）
  existing.tags = [...new Set([...existing.tags, ...incoming.tags])];
  existing.allergens = [...new Set([...existing.allergens, ...incoming.allergens])];
  
  // 4. 添加来源记录
  addFoodSource(existing.id, incoming);
  
  // 5. 记录冲突
  detectAndLogConflicts(existing, incoming);
  
  return existing;
}
```

### 4.6 Step 5: AI 标注 (见下文第5节)

### 4.7 Step 6: 校验 (Validate)

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const validationRules = [
  // 必须字段检查
  { rule: 'required', fields: ['name', 'category', 'calories'] },
  
  // 范围检查
  { rule: 'range', field: 'calories', min: 0, max: 900 },
  { rule: 'range', field: 'quality_score', min: 1, max: 10 },
  { rule: 'range', field: 'satiety_score', min: 1, max: 10 },
  { rule: 'range', field: 'confidence', min: 0, max: 1 },
  { rule: 'range', field: 'processing_level', min: 1, max: 4 },
  
  // 一致性检查
  { rule: 'macro_consistency' },  // protein + fat + carbs ≈ calories 推导
  
  // 分类一致性
  { rule: 'category_valid', allowed: VALID_CATEGORIES },
  { rule: 'sub_category_matches_category' },
  
  // 标签一致性
  { rule: 'tags_match_nutrition' },  // high_protein 但 protein < 15g → warning
];
```

### 4.8 Step 7: 入库 (Persist)

```typescript
async function persistFood(validated: ValidatedFood): Promise<Food> {
  return await dataSource.transaction(async (manager) => {
    // 1. Upsert 主表
    const food = await manager.save(Food, {
      ...validated,
      dataVersion: (existing?.dataVersion ?? 0) + 1,
    });
    
    // 2. 保存翻译
    for (const trans of validated.translations) {
      await manager.upsert(FoodTranslation, {
        foodId: food.id,
        locale: trans.locale,
        ...trans,
      }, ['foodId', 'locale']);
    }
    
    // 3. 保存来源记录
    await manager.save(FoodSource, {
      foodId: food.id,
      ...validated.sourceInfo,
    });
    
    // 4. 记录变更日志
    await manager.save(FoodChangeLog, {
      foodId: food.id,
      version: food.dataVersion,
      action: existing ? 'update' : 'create',
      changes: computeDiff(existing, food),
      operator: validated.operator,
    });
    
    return food;
  });
}
```

### 4.9 Step 8: 冲突处理 (异步)

| 冲突类型 | 自动处理策略 | 人工介入条件 |
|---------|------------|------------|
| 热量差异 < 5% | 取高优先级来源值 | — |
| 热量差异 5-15% | 取加权平均 | — |
| 热量差异 > 15% | — | 标记待审核 |
| 分类不一致 | 取高优先级来源 | 两个权威来源冲突时 |
| GI 值差异 > 10 | — | 标记待审核 |
| 过敏原信息差异 | 取并集（安全优先） | — |

### 4.10 Step 9: 翻译 (异步)

```typescript
// AI 翻译 Prompt
const translatePrompt = `
你是食物营养数据翻译专家。请将以下食物信息翻译为 {targetLocale}。

要求：
1. 使用当地人最常用的食物名称
2. 别名列出当地常见的其他叫法
3. 份量描述使用当地习惯单位
4. 不要翻译品牌名

食物数据：
{foodData}

返回JSON格式：
{
  "name": "翻译后名称",
  "aliases": "别名1,别名2",
  "description": "简短描述",
  "serving_desc": "份量描述"
}
`;
```

---

## 5. AI 辅助标注方案

### 5.1 标注任务定义

| 标注任务 | 输入 | 输出 | 精度要求 |
|---------|------|------|---------|
| **分类标注** | 食物名 + 营养数据 | category + sub_category | > 95% |
| **标签生成** | 营养数据 + 分类 | tags[] | > 90% |
| **评分计算** | 完整营养数据 | quality_score + satiety_score | > 85% |
| **搭配推荐** | 食物名 + 分类 | compatibility{} | > 80% |
| **翻译** | 食物名 + 描述 | 多语言翻译 | > 90% (需校验) |
| **NOVA 分级** | 食物名 + 成分表 | processing_level | > 85% |
| **过敏原识别** | 食物名 + 成分表 | allergens[] | > 95% (安全关键) |
| **GI 估算** | 食物名 + 碳水/纤维 | glycemic_index | > 75% (仅估算) |

### 5.2 方案对比

| 维度 | 云模型 (DeepSeek V3) | 云模型 (GPT-4o) | 本地模型 (Qwen2.5-72B) |
|------|---------------------|----------------|----------------------|
| **成本/万条** | ≈ ¥15-30 | ≈ ¥80-200 | 硬件折旧 ≈ ¥5-10/次 |
| **延迟** | 1-3s/条 | 2-5s/条 | 3-8s/条 (A100) |
| **食物领域精度** | ⭐⭐⭐⭐ (中文优势) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **批量能力** | ✅ 支持 batch API | ✅ 支持 | ✅ 支持 |
| **数据隐私** | ⚠️ 数据上传到云端 | ⚠️ 数据上传到云端 | ✅ 数据本地 |
| **可商用** | ✅ | ✅ | ✅ (开源模型) |
| **扩展性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (受硬件限制) |
| **中文食物理解** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 5.3 推荐方案：云端为主 + 规则辅助

```
┌────────────────────────────────────────────┐
│             AI 标注分层策略                   │
├────────────────────────────────────────────┤
│                                            │
│  第1层 · 规则引擎（免费、100%精确）          │
│  ├── 根据营养数据自动计算 tags              │
│  │   protein ≥ 20 → "high_protein"        │
│  │   fiber ≥ 6 → "high_fiber"             │
│  │   calories ≤ 100 → "low_calorie"       │
│  ├── 根据公式计算 quality_score            │
│  ├── 根据公式计算 satiety_score            │
│  └── 根据营养数据计算 nutrient_density      │
│                                            │
│  第2层 · AI 标注（DeepSeek V3，低成本）      │
│  ├── category / sub_category 分类          │
│  ├── food_group 多样性分组                  │
│  ├── compatibility 搭配关系                 │
│  ├── processing_level NOVA 分级             │
│  ├── allergens 过敏原识别                   │
│  ├── meal_types 餐次适配                    │
│  └── 翻译 (中↔英↔日↔韩)                   │
│                                            │
│  第3层 · 人工审核（关键数据）                 │
│  ├── confidence < 0.8 的数据                │
│  ├── 过敏原标注（安全关键）                  │
│  └── 冲突数据解决                           │
│                                            │
└────────────────────────────────────────────┘
```

### 5.4 Prompt 设计

#### 5.4.1 食物分类 + 标签 + 评分 Prompt

```markdown
你是食品营养分析专家。请根据以下食物数据进行标注分析。

## 食物数据
- 名称: {name}
- 热量: {calories} kcal/100g
- 蛋白质: {protein} g/100g
- 脂肪: {fat} g/100g
- 碳水化合物: {carbs} g/100g
- 膳食纤维: {fiber} g/100g
- 糖: {sugar} g/100g
- 钠: {sodium} mg/100g

## 标注要求
请严格按JSON格式返回，不要添加任何多余文字：

```json
{
  "category": "protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite 中选一",
  "sub_category": "更精细的二级分类英文编码",
  "food_group": "多样性分组：meat|poultry|fish|seafood|egg|tofu|legume|rice|noodle|bread|potato|leafy|cruciferous|root|citrus|berry|tropical|nut|seed 等",
  "main_ingredient": "主要食材英文名",
  "processing_level": "NOVA分级 1-4 的数字",
  "meal_types": ["适合餐次: breakfast/lunch/dinner/snack"],
  "allergens": ["过敏原: gluten/dairy/nuts/soy/egg/shellfish/fish/wheat 按实际"],
  "compatibility": {
    "goodWith": ["最多5个适合搭配的食物英文名"],
    "badWith": ["最多3个不建议搭配的食物英文名"]
  },
  "tags": ["从标准标签库中选择匹配的标签"],
  "confidence": "0.0-1.0 你对本次标注的整体置信度"
}
```
```

#### 5.4.2 批量处理 Prompt

```markdown
你是食品营养分析专家。请对以下 {count} 个食物进行批量标注。

## 食物列表
{foods_json_array}

## 要求
对每个食物返回标注结果，整体以JSON数组格式返回：
[
  {"index": 0, "category": "...", "sub_category": "...", ...},
  {"index": 1, ...}
]

每条记录的字段与单条标注相同。批量处理时保持一致性。
```

#### 5.4.3 翻译 Prompt

```markdown
你是食品翻译专家。请将以下中文食物翻译为 {target_locale} ({language_name})。

## 食物
- 中文名: {name_zh}
- 分类: {category}
- 简述: {description}

## 翻译要求
1. 使用当地人最常用的名称（不是直译）
2. 别名列出当地其他常见叫法
3. 份量描述使用当地计量习惯

返回JSON：
{
  "name": "翻译后名称",
  "aliases": "别名1,别名2",
  "description": "简短描述（一句话）",
  "serving_desc": "本地化份量描述"
}
```

### 5.5 JSON 输出约束方案

```typescript
// 1. 使用 DeepSeek JSON Mode (response_format: { type: "json_object" })
// 2. 响应后 Zod Schema 验证
import { z } from 'zod';

const FoodLabelSchema = z.object({
  category: z.enum(['protein', 'grain', 'veggie', 'fruit', 'dairy', 'fat', 'beverage', 'snack', 'condiment', 'composite']),
  sub_category: z.string().min(1).max(50),
  food_group: z.string().min(1).max(30),
  main_ingredient: z.string().min(1).max(50),
  processing_level: z.number().int().min(1).max(4),
  meal_types: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])),
  allergens: z.array(z.string()),
  compatibility: z.object({
    goodWith: z.array(z.string()).max(5),
    badWith: z.array(z.string()).max(3),
  }),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

// 3. 失败重试策略：最多3次，每次调整 prompt 增加约束提示
// 4. 最终失败标记 confidence = 0.5，进入人工审核队列
```

### 5.6 成本估算（以 10,000 条食物数据计）

| 项目 | DeepSeek V3 | GPT-4o-mini |
|------|------------|------------|
| 单次标注 Token（输入+输出） | ≈ 800 tokens | ≈ 800 tokens |
| 单价 | ¥0.002/1K tokens | $0.015/1K tokens |
| 分类+标签标注 (10K) | ≈ ¥16 | ≈ ¥120 |
| 翻译 4 语言 (40K) | ≈ ¥64 | ≈ ¥480 |
| 总计 | **≈ ¥80** | **≈ ¥600** |

**结论：使用 DeepSeek V3 作为主 AI 通道，成本极低，中文食物理解优秀。**

---

## 6. 本地 AI 实施方案

### 6.1 适用场景

本地 AI 主要用于 **食物图片识别**（非文本标注），即用户拍照后自动识别食物种类。

> 文本标注（分类/标签/评分）推荐使用云端 API，因为：
> - 成本已经极低（¥80/万条）
> - 精度更高
> - 无需维护 GPU 硬件

### 6.2 食物图片识别模型选择

| 模型 | 类型 | 参数量 | 精度 (Top-5) | 推理速度 | 推荐度 |
|------|------|--------|-------------|---------|--------|
| **Google Food-101 ViT** | 分类 | 86M | 93% | 快 | ⭐⭐⭐ |
| **Florence-2** | 多模态 | 0.7B | 90%+ | 中 | ⭐⭐⭐⭐ |
| **Qwen2-VL-7B** | 多模态VLM | 7B | 95%+ (中餐) | 慢 | ⭐⭐⭐⭐⭐ |
| **InternVL2.5** | 多模态VLM | 8B | 95%+ | 慢 | ⭐⭐⭐⭐⭐ |

### 6.3 推荐方案

**中短期（推荐）：** 直接调用 DeepSeek-VL 或 GPT-4o-mini 的视觉 API 进行图片识别，无需本地部署。

**长期（如需完全离线）：**

```
硬件要求：
  - GPU: NVIDIA RTX 4090 (24GB) 或 A100 (40GB)
  - RAM: 32GB+
  - 存储: 100GB SSD

部署架构：
  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
  │ NestJS API  │────▶│ vLLM / Ollama│────▶│ Qwen2-VL-7B  │
  │ Server      │     │ 推理引擎      │     │ 模型          │
  └─────────────┘     └──────────────┘     └──────────────┘
  
  使用 vLLM 或 Ollama 作为推理引擎：
  $ ollama pull qwen2-vl:7b
  $ ollama serve --port 11434
  
  API 调用：
  POST http://localhost:11434/api/chat
  {
    "model": "qwen2-vl:7b",
    "messages": [{
      "role": "user",
      "content": "识别图片中的食物并返回JSON...",
      "images": ["base64_encoded_image"]
    }]
  }
```

### 6.4 ComfyUI 方案（不推荐用于食物标注）

ComfyUI 主要面向图片**生成**（Stable Diffusion），不适合用于食物**识别/分类**任务。如果只是做图片识别，直接用 vLLM + Qwen2-VL 更合适。

ComfyUI 可用场景：
- 给食物库生成标准展示图片（AI 生图）
- 食物图片风格统一化处理

---

## 7. 实施路线图

### 7.1 MVP 阶段（第1-2周）

**目标：在现有 `foods` 表基础上扩展，不做破坏性变更**

```
Week 1:
  Day 1-2: 数据库迁移
    ├── 新增字段: food_group, saturated_fat, trans_fat, cholesterol, 
    │   potassium, calcium, iron, vitamin_a, vitamin_c,
    │   processing_level, allergens, nutrient_density,
    │   compatibility, common_portions, image_url, 
    │   barcode, code, status, popularity, data_version,
    │   verified_by, verified_at, primary_source_id
    └── 创建 food_translations 表
    
  Day 3-4: USDA 数据导入脚本
    ├── USDA API 采集器实现
    ├── 字段映射 + 标准化
    └── 导入 Top 200 常见食物

  Day 5: AI 标注 Pipeline
    ├── DeepSeek V3 标注服务
    ├── 分类 + 标签 + 评分 批量标注
    └── 标注结果入库
    
Week 2:
  Day 1-2: 中国食物数据补充
    ├── 导入 150 个常见中国食物
    ├── AI 翻译（中→英）
    └── 人工校验
    
  Day 3-4: 后台管理升级
    ├── 食物库管理页面增加新字段
    ├── 翻译管理
    ├── AI 标注触发按钮
    └── 冲突审核界面
    
  Day 5: 测试 + 上线
    ├── 数据质量验证
    ├── API 性能测试
    └── 灰度上线
```

### 7.2 第二阶段（第3-6周）

```
├── Open Food Facts 对接（条形码扫描）
├── food_sources 多来源追踪表
├── food_change_logs 版本控制表
├── food_conflicts 冲突检测 + 自动处理
├── 去重 Pipeline
├── 标签体系完善（根据用户反馈调整）
├── 搭配关系大规模标注
├── food_regional_info 地区适配表
└── 管理后台：冲突解决界面 + 数据来源对比界面
```

### 7.3 第三阶段（第7-12周）

```
├── 食物图片识别（云端 VLM API）
├── 自动化 Pipeline（定时同步 USDA）
├── 用户行为学习（popularity 自动更新）
├── 推荐引擎联动（quality_score / compatibility 优化推荐）
├── AI 自动估算缺失营养数据
├── 多语言 App 支持（日语、韩语翻译）
├── 食物条形码扫描功能
└── 数据质量监控 Dashboard
```

### 7.4 长期演进

```
├── 自建食物知识图谱
├── 基于用户群体的个性化食物评分
├── 本地模型部署（离线识别能力）
├── 外卖平台食物数据对接（合法合规）
├── 营养师专家审核系统
├── 食物数据开放 API（B2B）
└── 自建食物图片数据集（用户贡献 + 审核）
```

---

## 附录 A: 数据库迁移 SQL (MVP 阶段)

```sql
-- 1. 给现有 foods 表添加新字段
ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(50),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS food_group VARCHAR(30),
  ADD COLUMN IF NOT EXISTS saturated_fat DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS trans_fat DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS cholesterol DECIMAL(6,1),
  ADD COLUMN IF NOT EXISTS potassium DECIMAL(7,1),
  ADD COLUMN IF NOT EXISTS calcium DECIMAL(7,1),
  ADD COLUMN IF NOT EXISTS iron DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS vitamin_a DECIMAL(7,1),
  ADD COLUMN IF NOT EXISTS vitamin_c DECIMAL(6,1),
  ADD COLUMN IF NOT EXISTS vitamin_d DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS vitamin_e DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS vitamin_b12 DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS folate DECIMAL(6,1),
  ADD COLUMN IF NOT EXISTS zinc DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS magnesium DECIMAL(6,1),
  ADD COLUMN IF NOT EXISTS glycemic_load DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS processing_level INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS nutrient_density DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS compatibility JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS common_portions JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS primary_source_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS data_version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS popularity INT DEFAULT 0;

-- 2. 生成 code（回填已有数据）
UPDATE foods SET code = 'FOOD_CN_' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::TEXT, 5, '0')
  WHERE code IS NULL;

-- 3. 重命名现有 source 字段
ALTER TABLE foods RENAME COLUMN source TO primary_source;

-- 4. 新索引
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_foods_food_group ON foods(food_group);
CREATE INDEX IF NOT EXISTS idx_foods_status ON foods(status);
CREATE INDEX IF NOT EXISTS idx_foods_allergens ON foods USING GIN(allergens);

-- 5. 创建翻译表
CREATE TABLE IF NOT EXISTS food_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  locale VARCHAR(10) NOT NULL,
  name VARCHAR(200) NOT NULL,
  aliases TEXT,
  description TEXT,
  serving_desc VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(food_id, locale)
);

-- 6. 创建来源表
CREATE TABLE IF NOT EXISTS food_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL,
  source_id VARCHAR(200),
  source_url VARCHAR(500),
  raw_data JSONB NOT NULL,
  mapped_data JSONB,
  confidence DECIMAL(3,2) DEFAULT 0.8,
  is_primary BOOLEAN DEFAULT false,
  priority INT DEFAULT 50,
  fetched_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. 创建变更日志表
CREATE TABLE IF NOT EXISTS food_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  version INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  changes JSONB NOT NULL,
  reason TEXT,
  operator VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 附录 B: 标签自动生成规则

```typescript
function generateTags(food: Food): string[] {
  const tags: string[] = [];
  
  // 营养特征标签
  if (food.protein >= 20) tags.push('high_protein');
  if (food.fat <= 3) tags.push('low_fat');
  if (food.carbs <= 5) tags.push('low_carb');
  if (food.fiber >= 6) tags.push('high_fiber');
  if (food.calories <= 100) tags.push('low_calorie');
  if (food.sodium <= 120) tags.push('low_sodium');
  if (food.sugar <= 5) tags.push('low_sugar');
  if (food.glycemicIndex && food.glycemicIndex <= 55) tags.push('low_gi');
  
  // 目标适配标签
  if (food.protein >= 20 && food.fat <= 10) tags.push('muscle_gain');
  if (food.calories <= 150 && food.fiber >= 3) tags.push('weight_loss');
  if (food.carbs <= 10 && food.fat >= 10) tags.push('keto');
  if (['veggie', 'fruit', 'grain'].includes(food.category) && 
      !food.allergens?.includes('dairy') && !food.allergens?.includes('egg')) {
    tags.push('vegan');
  }
  if (food.glycemicIndex && food.glycemicIndex <= 55 && food.sugar <= 5) {
    tags.push('diabetes_friendly');
  }
  if (food.saturatedFat <= 2 && food.transFat <= 0 && food.sodium <= 300) {
    tags.push('heart_healthy');
  }
  
  // 属性标签
  if (food.processingLevel === 1) tags.push('natural');
  if (food.processingLevel <= 2) tags.push('whole_food');
  
  return tags;
}
```

## 附录 C: DeepSeek 批量标注脚本示例

```typescript
// scripts/ai-label-foods.ts
import { DeepSeek } from 'deepseek-sdk';

const client = new DeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

async function labelFood(food: { name: string; calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; sodium: number }) {
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: '你是食品营养分析专家。对输入的食物数据进行分类标注，严格按指定JSON Schema返回。'
    }, {
      role: 'user',
      content: `食物: ${food.name}
热量: ${food.calories} kcal/100g
蛋白质: ${food.protein} g/100g
脂肪: ${food.fat} g/100g
碳水: ${food.carbs} g/100g
纤维: ${food.fiber} g/100g
糖: ${food.sugar} g/100g
钠: ${food.sodium} mg/100g

返回JSON: {
  "category": "protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite",
  "sub_category": "string",
  "food_group": "string",
  "main_ingredient": "string",
  "processing_level": 1-4,
  "meal_types": ["breakfast"|"lunch"|"dinner"|"snack"],
  "allergens": [],
  "compatibility": {"goodWith": [], "badWith": []},
  "confidence": 0.0-1.0
}`
    }],
    temperature: 0.1,
    max_tokens: 500,
  });
  
  return JSON.parse(response.choices[0].message.content);
}

// 批量处理
async function batchLabel(foods: any[], batchSize: number = 5) {
  const results = [];
  for (let i = 0; i < foods.length; i += batchSize) {
    const batch = foods.slice(i, i + batchSize);
    const promises = batch.map(f => labelFood(f));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
    console.log(`Labeled ${Math.min(i + batchSize, foods.length)} / ${foods.length}`);
  }
  return results;
}
```

---

## 附录 D: 与现有系统集成关系

```
┌──────────────────────────────────────────────────────────────┐
│                    wuwei-AI 系统架构                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌──────────────────┐                    │
│  │ 小程序/Web   │───▶│ NestJS API Server │                    │
│  │ (用户端)     │    │                  │                    │
│  └─────────────┘    └───────┬──────────┘                    │
│                             │                                │
│            ┌────────────────┼─────────────────┐              │
│            ▼                ▼                  ▼              │
│  ┌─────────────┐  ┌─────────────────┐  ┌───────────┐       │
│  │ foods 主表   │  │ food_records    │  │ daily_plans│       │
│  │ (本次升级)   │  │ (饮食记录)       │  │ (日计划)   │       │
│  │             │  │ foods.foodId ──▶│  │            │       │
│  │ + translations│ └─────────────────┘  └───────────┘       │
│  │ + sources    │                                           │
│  │ + change_logs│  ┌─────────────────┐  ┌───────────┐       │
│  │ + conflicts  │  │ recommendation  │  │ ai_decision│       │
│  └──────┬──────┘  │ _feedbacks      │  │ _logs     │       │
│         │         │ foodId ────────▶│  └───────────┘       │
│         │         └─────────────────┘                       │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────┐                    │
│  │          数据加工 Pipeline            │                    │
│  │ USDA Sync / AI Label / Dedup / ...  │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
│  ┌─────────────────────────────────────┐                    │
│  │        Admin 管理后台                 │                    │
│  │ 食物管理 / 翻译管理 / 冲突审核 / ...  │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**关键集成点：**

1. `food_records.foods[].name` 关联 → `foods.name` 或 `food_translations.name`
2. `recommendation_feedbacks.foodId` 关联 → `foods.id`
3. `daily_plans` 推荐菜品生成依赖 → `foods.quality_score / compatibility / meal_types`
4. AI 决策引擎依赖 → `foods.tags / nutrient_density / processing_level`
5. 用户行为分析 → `foods.popularity` 自动累加
