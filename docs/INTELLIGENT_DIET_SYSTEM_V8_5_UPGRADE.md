# Intelligent Diet System — V8.5 Upgrade Notes

## Overview

V8.5 focuses on three areas: data quality fixes, internationalization of AI enrichment, and front-end statistics completeness.

---

## Changes

### Backend — `food-library-management.service.ts`

**`getStatistics()` — added `avgCompleteness` field**

- Added a concurrent `AVG(data_completeness)` query (filtered to `data_completeness > 0` to exclude pending foods from skewing the mean).
- `avgCompleteness` is now returned alongside all existing statistics fields.
- Front-end type `FoodLibraryStatistics` updated accordingly.

**Fixed duplicate `cookingMethods` identifier in `food.types.ts`**

- The legacy non-optional `cookingMethods: string[]` declaration at line 147 was removed.
- The canonical optional declaration at line 197 (`cookingMethods?: string[]`, V7.1) is retained.
- Resolves TS2300 / TS2687 / TS2717 compile errors.

---

### Backend — `food-enrichment.service.ts`

**AI enrichment internationalized (USDA-first standard)**

System prompt rewritten in English, referencing authoritative international databases in priority order:

1. USDA FoodData Central (primary)
2. FAO/INFOODS International Food Composition Tables
3. EUROFIR (European Food Information Resource)
4. Codex Alimentarius
5. Monash University FODMAP database
6. International GI database (University of Sydney)
7. NOVA food classification system

**User prompt rules updated**

- All context labels switched from Chinese to English (e.g. `热量` → `Calories`, `蛋白质` → `Protein`).
- Rule #2 now cites USDA FoodData Central and FAO/INFOODS explicitly.
- Reasoning instruction changed from "注明推算" to "mark estimated values as 'estimated'".

**`FIELD_DESC` fully rewritten (international standard)**

Every field description now provides:

- Type, JSON key, unit, and valid range
- Reference standard (e.g. USDA, Monash FODMAP, NOVA, Big-9 allergens)
- Clear enumeration of allowed values

Key improvements by field:

| Field             | Before                       | After                                                                                                    |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `foodForm`        | 中文三项说明                 | English + decision rule based on "as commonly sold/served"                                               |
| `aliases`         | 无描述                       | Explicit instructions: EN synonyms, regional names in native script, brand-generic names; 500-char limit |
| `cookingMethods`  | 中文短码列表（~10项）        | Full English enum (20 methods), first element = primary method                                           |
| `allergens`       | 中文 Big-8                   | International Big-9 (adds sesame)                                                                        |
| `processingLevel` | 中文说明                     | NOVA 1-4 classification with standard descriptions                                                       |
| `fodmapLevel`     | low/medium/high              | Monash University FODMAP guidelines cited                                                                |
| `glycemicIndex`   | 整数0-100                    | "glucose=100 reference; use international GI database values"                                            |
| `commonPortions`  | `{"name":"1碗","grams":200}` | Standard international measurements (cup, tbsp, slice…)                                                  |

---

### Frontend — `foodLibraryService.ts`

- `FoodLibraryStatistics` interface: added `avgCompleteness: number` field (V8.5).

### Frontend — `food-library/list/index.tsx`

- "数据完整度" card title now displays `avgCompleteness` inline:
  ```
  数据完整度   均值 72.3%
  ```

---

## Files Modified

| File                                                                        | Change                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/api-server/src/modules/food/admin/food-library-management.service.ts` | `getStatistics()` + `avgCompleteness`                  |
| `apps/api-server/src/modules/food/food.types.ts`                            | Remove duplicate `cookingMethods`                      |
| `apps/api-server/src/food-pipeline/services/food-enrichment.service.ts`     | FIELD_DESC, system prompt, user prompt, context labels |
| `apps/admin/src/services/foodLibraryService.ts`                             | `FoodLibraryStatistics.avgCompleteness` type           |
| `apps/admin/src/pages/food-library/list/index.tsx`                          | Show `avgCompleteness` in completeness card title      |

---

## Compatibility

- No database schema changes.
- No new API endpoints.
- Fully backward compatible — `avgCompleteness` is additive; existing consumers will simply ignore it if not yet consumed.
