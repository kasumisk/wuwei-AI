/**
 * 字段描述映射（用于 Prompt 构造）
 *
 * 拆分自 food-enrichment.service.ts（步骤 1）。
 * 描述为 AI 补全 Prompt 的核心输入，每个字段的范围、单位、参考样例都在此集中维护。
 */

import { COOKING_METHODS_FIELD_DESC } from '../../../../modules/food/cooking-method.constants';

export const FIELD_DESC: Record<string, string> = {
  // ─── Stage 1: 核心营养素 (number, per 100g edible portion) ──────────
  // 数据来源优先级：USDA FoodData Central SR Legacy → Foundation Foods → FAO/INFOODS → EUROFIR
  protein:
    '[number] protein g/100g (0-100). Total nitrogen × conversion factor (6.25 general, 5.7 wheat, 6.38 dairy). ' +
    'Per 100g edible portion. USDA range ref: beef ~26g, chicken breast ~31g, cooked rice ~2.7g, apple ~0.3g.',
  fat:
    '[number] fat g/100g (0-100). Total lipids (ether extract method). Per 100g edible portion. ' +
    'USDA range ref: butter ~81g, salmon ~13g, whole milk ~3.7g, banana ~0.3g.',
  carbs:
    '[number] carbs g/100g (0-100). Total available carbohydrates by difference (100 - protein - fat - fiber - moisture - ash). ' +
    'Per 100g edible portion. USDA range ref: white rice cooked ~28g, bread ~49g, orange ~12g.',
  fiber:
    '[number] fiber g/100g (0-80). Total dietary fiber (AOAC method). Per 100g edible portion. ' +
    'USDA range ref: oat bran ~15g, lentils cooked ~8g, apple ~2.4g, white rice cooked ~0.4g.',
  sugar:
    '[number] sugar g/100g (0-100). Total sugars (sum of free mono- and disaccharides, natural + added). Per 100g. ' +
    'USDA range ref: honey ~82g, dates ~63g, apple ~10g, plain yogurt ~5g.',
  addedSugar:
    '[number] added_sugar g/100g (0-100). Sugars added during processing or preparation (sucrose, HFCS, etc.). ' +
    '0 for whole unprocessed foods. Relevant for packaged/processed foods.',
  naturalSugar:
    '[number] natural_sugar g/100g (0-100). Inherent sugars present in unprocessed food (fructose in fruit, lactose in dairy). ' +
    'For whole foods, natural_sugar ≈ total sugar. For processed foods, natural_sugar = total_sugar − added_sugar.',
  sodium:
    '[number] sodium mg/100g (0-50000). Total sodium from all sources (intrinsic + added salt/additives). ' +
    'USDA range ref: table salt ~38758mg, soy sauce ~5493mg, canned soup ~430mg, fresh chicken ~74mg, fresh apple ~1mg.',
  // ─── Stage 1: 食物形态 ───────────────────────────────────────────────
  // V8.4: food_form 移至 Stage1，是基础属性，决定后续阶段上下文
  foodForm:
    '[string] food_form: "ingredient" | "dish" | "semi_prepared". ' +
    '"ingredient" = raw or minimally processed single-ingredient food, sold/used as a culinary building block ' +
    '(e.g. chicken breast, brown rice, apple, olive oil, cheddar cheese, dried lentils). ' +
    '"dish" = ready-to-eat or ready-to-serve composed meal or recipe, typically multi-ingredient ' +
    '(e.g. fried rice, beef stew, Caesar salad, pizza, ramen, scrambled eggs). ' +
    '"semi_prepared" = partially processed, requires further cooking/assembly before eating ' +
    '(e.g. dumpling wrappers, marinated raw meat, par-cooked pasta, instant noodle block, bread dough). ' +
    'Decision rule: classify as the food is COMMONLY SOLD/SERVED to consumers, not the theoretical raw state.',
  // ─── Stage 2: 微量营养素 (number, per 100g) ─────────────────────────
  // 数据来源：USDA FoodData Central → EUROFIR → FAO/INFOODS 区域表（亚洲/拉丁/非洲食物）
  calcium:
    '[number] calcium mg/100g (0-2000). Total calcium. ' +
    'USDA ref: parmesan ~1184mg, plain yogurt ~110mg, spinach cooked ~136mg, whole milk ~113mg, cooked chicken ~11mg.',
  iron:
    '[number] iron mg/100g (0-100). Total iron (heme + non-heme). ' +
    'USDA ref: chicken liver ~9mg, lentils cooked ~3.3mg, beef ~2.6mg, spinach raw ~2.7mg, white rice cooked ~0.2mg.',
  potassium:
    '[number] potassium mg/100g (0-10000). Total potassium. ' +
    'USDA ref: dried apricot ~1160mg, banana ~358mg, potato baked ~535mg, whole milk ~132mg.',
  cholesterol:
    '[number] cholesterol mg/100g (0-2000). Dietary cholesterol. ' +
    '0 for all plant foods. USDA ref: egg yolk ~1085mg, whole egg ~373mg, shrimp ~189mg, chicken breast ~85mg.',
  vitaminA:
    '[number] vitamin_a μg RAE/100g (0-50000). Retinol Activity Equivalents. ' +
    'RAE: retinol 1:1; β-carotene dietary 12:1; other provitamin-A 24:1. ' +
    'USDA ref: beef liver ~9442μg RAE, carrot raw ~835μg RAE, sweet potato baked ~961μg RAE, whole milk ~46μg RAE.',
  vitaminC:
    '[number] vitamin_c mg/100g (0-2000). Ascorbic acid (L-ascorbic acid). ' +
    'USDA ref: red bell pepper ~128mg, kiwi ~93mg, orange ~53mg, broccoli ~89mg, potato ~20mg. 0 for meat/fish.',
  vitaminD:
    '[number] vitamin_d μg/100g (0-1000). Total vitamin D (D2 ergocalciferol + D3 cholecalciferol). ' +
    'USDA ref: salmon ~11μg, canned tuna ~4.5μg, egg yolk ~2.2μg, fortified milk ~1μg. Near 0 for plant foods unless fortified.',
  vitaminE:
    '[number] vitamin_e mg/100g (0-500). Alpha-tocopherol equivalents (α-TE). ' +
    'USDA ref: wheat germ oil ~149mg, sunflower seeds ~35mg, almonds ~26mg, olive oil ~14mg, spinach ~2mg.',
  vitaminB12:
    '[number] vitamin_b12 μg/100g (0-100). Cobalamin (all forms). ' +
    '0 for all plant foods (unless fortified). USDA ref: clams ~98μg, beef liver ~83μg, salmon ~3.2μg, whole milk ~0.45μg.',
  folate:
    '[number] folate μg DFE/100g (0-5000). Dietary Folate Equivalents. ' +
    'DFE: food folate 1:1; synthetic folic acid ×1.7. ' +
    'USDA ref: chicken liver ~578μg DFE, lentils cooked ~181μg DFE, spinach raw ~194μg DFE, orange ~30μg DFE.',
  zinc:
    '[number] zinc mg/100g (0-100). Total zinc. ' +
    'USDA ref: oysters ~39mg, beef ~4.8mg, pumpkin seeds ~7.8mg, chickpeas cooked ~1.5mg, white rice cooked ~0.5mg.',
  magnesium:
    '[number] magnesium mg/100g (0-1000). Total magnesium. ' +
    'USDA ref: pumpkin seeds ~592mg, dark chocolate ~228mg, almonds ~270mg, spinach cooked ~87mg, banana ~27mg.',
  saturatedFat:
    '[number] saturated_fat g/100g (0-100). Total saturated fatty acids. ' +
    'USDA ref: butter ~51g, coconut oil ~87g, cheddar ~21g, beef ~7g, chicken breast ~0.9g, olive oil ~14g.',
  transFat:
    '[number] trans_fat g/100g (0-10). Total trans-fatty acids (industrial + ruminant). ' +
    'Industrial trans fat ≈0 in whole/unprocessed foods. Ruminant sources (butter ~3g, beef ~1g) have small amounts. ' +
    'Near 0 for plant foods. Partially hydrogenated oils may be 2-10g.',
  purine:
    '[number] purine mg/100g (0-2000). Total purines expressed as uric acid precursors. ' +
    'Ref: Kaneko et al. (2014) or ADA purine guidelines. ' +
    'High: organ meats >300mg, sardines ~345mg; Moderate: beef/pork ~100-200mg; Low: dairy/eggs/vegetables <50mg.',
  phosphorus:
    '[number] phosphorus mg/100g (0-2000). Total phosphorus. ' +
    'USDA ref: pumpkin seeds ~1174mg, parmesan ~694mg, salmon ~371mg, whole milk ~84mg, apple ~11mg.',
  vitaminB6:
    '[number] vitamin_b6 mg/100g (0-50). Pyridoxine and related forms. ' +
    'USDA ref: pistachio ~1.7mg, tuna ~0.9mg, potato baked ~0.6mg, banana ~0.37mg, whole milk ~0.04mg.',
  omega3:
    '[number] omega3 mg/100g (0-30000). Total Omega-3 fatty acids: ALA (α-linolenic) + EPA + DHA. ' +
    'Plant foods: ALA dominates (flaxseed ~22800mg, walnut ~9080mg). ' +
    'Fatty fish: EPA+DHA dominate (salmon ~2260mg, mackerel ~5134mg). Near 0 for most plant foods/grains.',
  omega6:
    '[number] omega6 mg/100g (0-50000). Total Omega-6 fatty acids (primarily linoleic acid LA). ' +
    'USDA ref: safflower oil ~74500mg, sunflower oil ~65700mg, corn oil ~53500mg, chicken ~1690mg, olive oil ~9763mg.',
  solubleFiber:
    '[number] soluble_fiber g/100g (0-40). Soluble dietary fiber (pectin, beta-glucan, inulin, psyllium). ' +
    'USDA ref: psyllium ~71g, oat bran ~6.5g, apple ~0.9g, lentils cooked ~1g. Typically 25-50% of total fiber.',
  insolubleFiber:
    '[number] insoluble_fiber g/100g (0-60). Insoluble dietary fiber (cellulose, hemicellulose, lignin). ' +
    'Typically 50-75% of total fiber. Wheat bran ~42g, kidney beans cooked ~5.5g, carrot raw ~1.6g.',
  waterContentPercent:
    '[number] water_content_percent % (0-100). Moisture content (weight loss on drying). ' +
    'USDA ref: cucumber ~95%, apple ~86%, cooked rice ~68%, bread ~37%, cheddar ~37%, dried pasta ~10%, crackers ~4%.',
  // ─── Stage 3: 健康属性 ──────────────────────────────────────────────
  // GI/GL: University of Sydney International GI Database (glycemicindex.com)
  // FODMAP: Monash University Low FODMAP App (monashfodmap.com)
  // NOVA: Monteiro et al., Public Health Nutrition (2019)
  glycemicIndex:
    '[number] glycemic_index integer 0-100. Reference food = glucose (GI=100) or white bread (GI=70). ' +
    'Authoritative source: International GI Database, University of Sydney. ' +
    'Low GI <55: most non-starchy vegetables, legumes, most fruits; Medium GI 55-69: oats, sweet potato; ' +
    'High GI ≥70: white bread ~75, white rice ~73, watermelon ~76. ' +
    'GI applies only to carbohydrate-containing foods; for pure protein/fat foods (meat, eggs, oils), use 0.',
  glycemicLoad:
    '[number] glycemic_load 0-50. GL = (GI × available carbohydrate g per 100g serving) / 100. ' +
    'Report per 100g basis. Low GL <10, Medium 10-19, High ≥20. ' +
    'Example: white rice GI=73, carbs=28g → GL = 73×28/100 = 20.4.',
  fodmapLevel:
    '[string] fodmap_level: "low" | "medium" | "high". ' +
    'Authority: Monash University Low FODMAP Diet App and published research. ' +
    'Low: most proteins, hard cheeses, blueberries, carrots, rice, oats (standard serve). ' +
    'Medium: avocado, sweet potato, canned legumes (rinsed). ' +
    'High: wheat, onion, garlic, apples, cow milk (lactose), legumes (unrinsed), stone fruit.',
  oxalateLevel:
    '[string] oxalate_level: "low" | "medium" | "high". ' +
    'Thresholds per 100g: low <10mg, medium 10-50mg, high >50mg. ' +
    'Reference: Harvard/MGH oxalate food lists. ' +
    'High: spinach ~750mg, rhubarb ~860mg, beets ~152mg. Medium: sweet potato ~28mg. Low: eggs, meat, dairy.',
  processingLevel:
    '[number] processing_level integer 1-4. NOVA classification (Monteiro et al., 2019): ' +
    '1=unprocessed or minimally processed (whole fruits, vegetables, fresh meat, eggs, plain milk, dried legumes). ' +
    '2=processed culinary ingredient (vegetable oils, butter, flour, salt, sugar, honey — used to prepare dishes). ' +
    '3=processed food (canned vegetables/fish, salted nuts, smoked meats, artisan cheese, freshly baked bread). ' +
    '4=ultra-processed (soft drinks, packaged snacks, instant noodles, reconstituted meat products, flavored yogurt).',
  // ─── Stage 3: allergens & tags (also in Stage 3) ────────────────────
  allergens:
    '[string[]] allergens array. Use FDA "Big-9" international standard allergens only: ' +
    'gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame. ' +
    'Empty array [] if food contains none. Do NOT add non-standard allergens. ' +
    'Cross-contamination risk does NOT qualify — only allergens present as ingredients.',
  tags:
    '[string[]] tags Applicable diet/nutrition tags. Choose ONLY from: ' +
    'high_protein(>20g/100g)/low_fat(<3g/100g)/low_carb(<10g/100g)/high_fiber(>5g/100g)/' +
    'low_calorie(<120kcal/100g)/low_sodium(<120mg/100g)/low_sugar(<5g/100g)/' +
    'vegan/vegetarian/gluten_free/dairy_free/keto/paleo/whole_food. ' +
    "Apply only tags that are objectively supported by the food's nutritional data.",
  // ─── Stage 4: 使用属性 ──────────────────────────────────────────────
  subCategory:
    '[string] sub_category Lowercase English code describing the specific food sub-type. ' +
    'Examples: lean_meat/fatty_meat/organ_meat/whole_grain/refined_grain/leafy_green/cruciferous/' +
    'root_vegetable/allium/citrus_fruit/tropical_fruit/berry/stone_fruit/legume/' +
    'dairy_product/hard_cheese/soft_cheese/nut/seed/cold_pressed_oil/refined_oil/' +
    'fermented_food/processed_meat/baked_good/sweet_snack/savory_snack.',
  foodGroup:
    '[string] food_group Lowercase English code for the primary food group. ' +
    'Values: meat/poultry/fish/seafood/egg/dairy/grain/legume/vegetable/fruit/nut/seed/fat/oil/' +
    'sweetener/beverage/herb/spice/condiment/processed.',
  cuisine:
    '[string] cuisine Primary cultural cuisine of origin. Lowercase English code. ' +
    'Values: chinese/japanese/korean/indian/thai/vietnamese/malay/filipino/middle_eastern/' +
    'italian/french/spanish/greek/mediterranean/american/mexican/latin_american/' +
    'british/german/eastern_european/african/international. ' +
    'Use "international" for globally ubiquitous staple foods (rice, bread, eggs, apple).',
  mealTypes:
    '[string[]] meal_types Applicable meal occasions. Values: breakfast/lunch/dinner/snack/brunch/dessert/appetizer. ' +
    'Most main dishes apply to lunch+dinner. Breakfast foods include cereals, eggs, toast. Return 1-4 values.',
  commonPortions:
    '[object[]] common_portions JSON array of 2-4 typical serving sizes. Format: [{"name":"<description>","grams":<number>}]. ' +
    'Use standard international measurements (e.g. "1 cup", "1 tbsp", "1 slice", "1 medium piece"). ' +
    'Reference USDA FNDDS standard portion sizes where available. ' +
    'Example: [{"name":"1 cup cooked","grams":186},{"name":"1/2 cup cooked","grams":93}].',
  qualityScore:
    '[number] quality_score 0-10. Overall nutritional quality score. ' +
    'Consider: nutrient density (vitamins/minerals per calorie), NOVA processing level (lower = better), ' +
    'fiber content, presence of harmful components (trans fat, excess sodium), alignment with WHO dietary guidelines. ' +
    'Ref: whole vegetables/fruits/legumes ≈8-10; lean meats ≈6-8; processed snacks ≈1-3.',
  satietyScore:
    '[number] satiety_score 0-10. Satiety/fullness score. ' +
    'Based on Holt et al. (1995) satiety index research. Key drivers: protein content, fiber content, food volume/water content, texture. ' +
    'High: potatoes ~8, lean meat ~7, legumes ~7; Medium: whole grain bread ~5, cheese ~5; Low: croissant ~2, candy ~1.',
  nutrientDensity:
    '[number] nutrient_density 0-100. Micronutrient density relative to calorie content. ' +
    'Based on ANDI (Aggregate Nutrient Density Index) or similar methodology. ' +
    'High: leafy greens ~900-1000 normalized to 0-100; Low: refined sugar/oils ≈1-5.',
  commonalityScore:
    '[number] commonality_score 0-100. Global availability and consumption frequency. ' +
    '100=universally consumed daily staple (rice, bread, salt). 80=very common in most cultures (chicken, tomato, apple). ' +
    '50=regionally common. 20=specialty ingredient. 5=rare/niche food.',
  popularity:
    '[number] popularity 0-100. Estimated consumer popularity / demand for this food. ' +
    'Reflects how often people actively seek out, order, or purchase this food item. ' +
    '100=globally iconic, extremely in-demand (pizza, sushi, fried chicken). ' +
    '80=widely popular in its region or cuisine (pad thai, tacos, dim sum). ' +
    '60=moderately popular, regularly consumed. ' +
    '40=niche or traditional food with limited mainstream appeal. ' +
    '20=rarely sought, mostly consumed out of necessity or cultural habit. ' +
    '0=near-unknown or historical/extinct food. ' +
    'Distinct from commonality_score (availability) — a food can be widely available but unpopular, or rare but highly coveted.',
  standardServingDesc:
    '[string] standard_serving_desc Human-readable standard serving size. ' +
    'Format: "<quantity> <unit> (<grams>g)". Use USDA FNDDS or national dietary guideline serving sizes. ' +
    'Examples: "1 cup cooked (186g)", "1 medium apple (182g)", "3 oz cooked (85g)", "1 slice (28g)".',
  mainIngredient:
    '[string] main_ingredient Single primary ingredient in lowercase English. ' +
    'For single-ingredient foods, use the food itself (e.g. "chicken", "rice", "apple"). ' +
    'For composed dishes, use the predominant protein or starch (e.g. "beef" for beef stew, "pasta" for spaghetti).',
  flavorProfile:
    '[object] flavor_profile Flavor intensity scores 0-5 for each dimension. ' +
    'Format: {"sweet":<0-5>,"salty":<0-5>,"sour":<0-5>,"spicy":<0-5>,"bitter":<0-5>,"umami":<0-5>}. ' +
    'All 6 keys are required. 0=absent, 1=very mild, 2=mild, 3=moderate, 4=strong, 5=dominant. ' +
    'Example for soy sauce: {"sweet":1,"salty":5,"sour":0,"spicy":0,"bitter":1,"umami":4}.',
  // ─── Stage 4: aliases ───────────────────────────────────────────────
  aliases:
    '[string] aliases Comma-separated alternative names for this food. Critical for search discoverability. ' +
    'Include ALL of the following where applicable: ' +
    '(1) English synonyms and spelling variants (e.g. "aubergine" for "eggplant"). ' +
    '(2) Regional/local names in their native script for widely recognized foods (e.g. "茄子" for eggplant, "なす"). ' +
    '(3) Common brand-generic names and abbreviated forms. ' +
    '(4) Scientific or formal names if commonly known (e.g. "Solanum melongena"). ' +
    '(5) Common cooking/menu names (e.g. "melanzane" for eggplant in Italian cuisine). ' +
    'Target 3-8 aliases. Keep total under 500 characters. ' +
    'Example for "白米饭": "steamed white rice, cooked rice, plain rice, boiled rice, 米飯, ご飯, 쌀밥". ' +
    'Example for "Greek yogurt": "strained yogurt, labneh, 希腊酸奶, 水切りヨーグルト, skyr (Icelandic variant)".',
  // ─── Stage 5: 扩展属性 ──────────────────────────────────────────────
  ingredientList:
    '[string[]] ingredient_list Complete list of ingredients in English, ordered by weight (largest first). ' +
    'Use standard food ingredient names (e.g. "chicken breast", "garlic", "extra virgin olive oil", "sea salt"). ' +
    'For single-ingredient whole foods, return array with one element: ["apple"] or ["chicken breast"]. ' +
    'For composed dishes, list all recognizable ingredients. Do not list sub-ingredients of processed components.',
  cookingMethods: COOKING_METHODS_FIELD_DESC,
  textureTags:
    '[string[]] texture_tags Applicable texture descriptors. Return 1-5 most relevant. ' +
    'Values: crispy/crunchy/tender/soft/chewy/creamy/smooth/fluffy/dense/flaky/gelatinous/fibrous/juicy/dry/sticky. ' +
    "Select based on the food's most common preparation state (cooked unless inherently raw).",
  dishType:
    '[string] dish_type Primary dish category for composed dishes. ' +
    'Values: "dish" | "soup" | "drink" | "dessert" | "snack" | "staple" | "salad" | "sauce" | "bread" | "pastry". ' +
    'For raw ingredients or single-ingredient foods, use the most appropriate category if consumed directly, or null if not applicable.',
  prepTimeMinutes:
    '[number] prep_time_minutes Active preparation time in minutes (0-480) before cooking begins. ' +
    'Includes: washing, cutting, marinating, measuring. Excludes: passive marinating/soaking time, cooking time. ' +
    'Ref: simple salads ~5min, whole roast chicken ~15min, complex pastry ~60min. For raw single ingredients: 0-5.',
  cookTimeMinutes:
    '[number] cook_time_minutes Active cooking time in minutes (0-720). ' +
    'Time from heat-on to food ready. Stir-fry ~5min, steamed fish ~10min, roast chicken ~90min, beef stew ~120min. ' +
    'For raw uncooked foods (salad, sashimi): 0.',
  skillRequired:
    '[string] skill_required Culinary skill level required. ' +
    '"beginner" = no technique required (boiling pasta, scrambled eggs, simple salad). ' +
    '"intermediate" = basic technique (stir-fry, simple baking, pan-seared protein). ' +
    '"advanced" = multiple techniques, timing (French sauces, dim sum, soufflé). ' +
    '"expert" = professional-level precision (croissant lamination, molecular gastronomy, multi-day fermentation).',
  estimatedCostLevel:
    '[number] estimated_cost_level 1-5 relative cost index based on global average market price per 100g. ' +
    '1=very cheap staple (rice, flour, salt, lentils, cabbage). 2=affordable common food (eggs, chicken, pasta, banana). ' +
    '3=average cost (beef, cheese, berries, specialty vegetables). 4=premium (salmon, nuts, aged cheese, exotic fruit). ' +
    '5=luxury/rare (truffles, saffron, premium seafood, wagyu beef).',
  shelfLifeDays:
    '[number] shelf_life_days Typical shelf life in days under recommended storage conditions. ' +
    'Reference: FDA food safety guidelines / USDA storage recommendations. ' +
    'Fresh leafy greens: 3-7; fresh meat/fish: 1-3; whole fruit: 5-14; cooked leftovers: 3-5; ' +
    'whole grains/pasta: 730-1825; canned goods: 730-1825; honey: indefinite (use 3650).',
  servingTemperature:
    '[string] serving_temperature Typical serving temperature. ' +
    '"hot" = served >60°C (soups, stews, hot entrées). "warm" = 40-60°C (some sandwiches, warm salads). ' +
    '"room_temp" = 15-25°C (bread, fresh fruit, most raw foods). "cold" = 4-15°C (salads, chilled desserts, cold cuts). ' +
    '"frozen" = served/consumed frozen (ice cream, frozen desserts).',
  dishPriority:
    '[number] dish_priority 0-100. Priority weight for meal recommendation algorithms. ' +
    '0 for raw single ingredients (they are components, not recommended as standalone meals). ' +
    'Common dishes: 50-70. Popular/versatile dishes: 70-85. Signature/highly popular dishes: 85-100.',
  acquisitionDifficulty:
    '[number] acquisition_difficulty 1-5. Ease of obtaining this food globally. ' +
    '1=available in any supermarket worldwide (rice, chicken, apple, salt). ' +
    '2=available in most supermarkets in developed countries. ' +
    '3=requires specialty/ethnic grocery store. ' +
    '4=seasonal or limited regional availability. ' +
    '5=rare, highly imported, or requires special sourcing.',
  compatibility:
    '[object] compatibility Food pairing guide. ' +
    'Format: {"good":["<food1>","<food2>",...],"avoid":["<food3>",..."]}. ' +
    'Both arrays required (can be empty). "good": foods that enhance flavor, nutrition, or texture when paired. ' +
    '"avoid": foods that clash in flavor, create unhealthy nutritional combinations, or are culturally inappropriate pairings. ' +
    'Provide 2-5 items per array based on culinary tradition and food science.',
  availableChannels:
    '[string[]] available_channels Purchase/acquisition channels for this food. ' +
    'Values: supermarket/convenience_store/wet_market/farmers_market/online/specialty_store/restaurant/bakery/pharmacy. ' +
    'Return all applicable channels. Most common foods: ["supermarket","wet_market"]. ' +
    'Specialty items: ["specialty_store","online"]. Restaurant dishes: ["restaurant"].',
  requiredEquipment:
    '[string[]] required_equipment Kitchen equipment needed to prepare this food from its typical sold state. ' +
    'Values: oven/wok/steamer/blender/food_processor/microwave/grill/air_fryer/pressure_cooker/rice_cooker/knife/none. ' +
    'For raw ready-to-eat foods (fruit, raw vegetables): ["none"]. ' +
    'Include all equipment required for the primary preparation method.',
};
