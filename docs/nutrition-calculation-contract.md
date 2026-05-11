# Nutrition Calculation Contract

> **Source of truth**: `apps/api-server/src/modules/user/app/services/profile/user-profile.service.ts`  
> Any Flutter preview **must** mirror this spec exactly.  
> Last updated: 2026-05-09

---

## 1. BMR

### Katch-McArdle (preferred — when `bodyFatPercent` is available and in range 3–60 %)

```
leanMass = weightKg × (1 − bodyFatPercent / 100)
BMR      = 370 + 21.6 × leanMass
```

### Harris-Benedict (fallback — no valid body-fat data)

| Gender | Formula |
|--------|---------|
| male   | `88.362 + 13.397 × weightKg + 4.799 × heightCm − 5.677 × age` |
| female | `447.593 + 9.247 × weightKg + 3.098 × heightCm − 4.33 × age` |

Fallback values when fields are missing: `weightKg=65`, `heightCm=170`, `birthYear=1990`.  
`age = currentYear − birthYear`

---

## 2. TDEE

### Mode A — exerciseProfile available (`type ≠ 'none'`, `frequencyPerWeek > 0`, `avgDurationMinutes > 0`)

```
NEAT multipliers (daily-activity only, not counting exercise):
  sedentary → 1.2
  light     → 1.3
  moderate  → 1.4
  active    → 1.5

MET values (ACSM reference):
  cardio   → 6.0
  strength → 5.0
  mixed    → 5.5

perSessionCal    = (MET − 1) × weightKg × (avgDurationMinutes / 60)
dailyExerciseCal = perSessionCal × frequencyPerWeek / 7
TDEE             = BMR × NEAT + dailyExerciseCal
```

### Mode B — no exerciseProfile (classic coarse multipliers)

| activityLevel | multiplier |
|---------------|-----------|
| sedentary     | 1.2       |
| light         | 1.375     |
| moderate      | 1.55      |
| active        | 1.725     |

```
TDEE = BMR × multiplier
```

Flutter preview **always uses Mode B** (exerciseProfile not sent during onboarding/edit preview).

---

## 3. Recommended Calories

```
goalMultiplier:
  fat_loss     → 0.80
  muscle_gain  → 1.10
  health       → 1.00
  habit        → 1.00

speedModifier:
  aggressive → −0.05
  steady     →  0.00
  relaxed    → +0.05

raw          = round(TDEE × (goalMultiplier + speedModifier))
minCalories  = gender === 'male' ? 1500 : 1200
recommended  = max(raw, minCalories)
```

---

## 4. Macro Targets

Base ratios `[protein, carb, fat]`:

| goal        | protein | carb | fat  |
|-------------|---------|------|------|
| fat_loss    | 0.35    | 0.40 | 0.25 |
| muscle_gain | 0.40    | 0.40 | 0.20 |
| health      | 0.25    | 0.50 | 0.25 |
| habit       | 0.25    | 0.50 | 0.25 |

Region bias may shift ratios (server only); Flutter preview uses base ratios without bias.

```
proteinG = round(calories × pRatio / 4)
carbG    = round(calories × cRatio / 4)
fatG     = round(calories × fRatio / 9)
```

---

## 5. Flutter Preview Rules

1. Preview is **read-only display** — never persisted by Flutter.  
2. Final saved values always come from the **server response** and overwrite any preview.  
3. Use `NutritionCalculator.preview(…)` — no inline math anywhere in widgets.  
4. Always use Mode B TDEE (no exercise profile in preview).  
5. Region bias is **not applied** in preview (server handles it).  
6. Return `null` (show placeholder) when required fields are missing.

---

## 6. Golden Test Cases

All values computed with `currentYear = 2026` (age = 2026 − birthYear).

### Case 1 — Male, moderate, fat_loss, steady (no body fat)
| Input | Value |
|-------|-------|
| gender | male |
| birthYear | 1996 (age 30) |
| heightCm | 170 |
| weightKg | 70 |
| activityLevel | moderate |
| goal | fat_loss |
| goalSpeed | steady |
| bodyFatPercent | — |

Harris-Benedict BMR = 88.362 + 13.397×70 + 4.799×170 − 5.677×30  
= 88.362 + 937.79 + 815.83 − 170.31 = **1 671.67**  
TDEE = 1671.67 × 1.55 = **2 591.09**  
raw  = round(2591.09 × (0.80 + 0.00)) = round(2072.87) = **2 073**  
recommended = max(2073, 1500) = **2 073 kcal**  
protein = round(2073 × 0.35 / 4) = **181 g**  
carb    = round(2073 × 0.40 / 4) = **207 g**  
fat     = round(2073 × 0.25 / 9) = **58 g**

### Case 2 — Female, light, muscle_gain, aggressive (no body fat)
| Input | Value |
|-------|-------|
| gender | female |
| birthYear | 2001 (age 25) |
| heightCm | 160 |
| weightKg | 55 |
| activityLevel | light |
| goal | muscle_gain |
| goalSpeed | aggressive |
| bodyFatPercent | — |

Harris-Benedict BMR = 447.593 + 9.247×55 + 3.098×160 − 4.33×25  
= 447.593 + 508.585 + 495.68 − 108.25 = **1 343.61**  
TDEE = 1343.61 × 1.375 = **1 847.46**  
raw  = round(1847.46 × (1.10 − 0.05)) = round(1847.46 × 1.05) = round(1939.83) = **1 940**  
recommended = max(1940, 1200) = **1 940 kcal**  
protein = round(1940 × 0.40 / 4) = **194 g**  
carb    = round(1940 × 0.40 / 4) = **194 g**  
fat     = round(1940 × 0.20 / 9) = **43 g**

### Case 3 — Male, sedentary, fat_loss, aggressive (Katch-McArdle)
| Input | Value |
|-------|-------|
| gender | male |
| birthYear | 1991 (age 35) |
| weightKg | 90 |
| bodyFatPercent | 25 |
| activityLevel | sedentary |
| goal | fat_loss |
| goalSpeed | aggressive |

leanMass = 90 × (1 − 0.25) = 67.5  
BMR = 370 + 21.6 × 67.5 = 370 + 1458 = **1 828**  
TDEE = 1828 × 1.2 = **2 193.6**  
raw  = round(2193.6 × (0.80 − 0.05)) = round(2193.6 × 0.75) = round(1645.2) = **1 645**  
recommended = max(1645, 1500) = **1 645 kcal**  
protein = round(1645 × 0.35 / 4) = **144 g**  
carb    = round(1645 × 0.40 / 4) = **165 g**  
fat     = round(1645 × 0.25 / 9) = **46 g**
