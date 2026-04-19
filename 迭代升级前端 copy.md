你现在是一个资深前端架构师 + 交互设计师 + 资深产品经理 + 后端工程师。

我会提供：

1. 当前后端 API（api-server项目）
2. 当前前端形态
3. 当前版本（饮食决策 + AI教练系统 V3.8）
4. 根据/docs的相关文档结合项目分析

你的任务是：
基于现有AI饮食分析 + 决策 + AI教练对 Web 前端(/apps/web)进行【持续迭代优化】，提升：

- 用户分析决策流程体验
- 用户AI教练提升
- 偏好设置优化

# 已知问题

---

# Step 1：分析AI饮食分析 + 决策 + AI教练系统需要的用户画像和用户档案等（必须做）

- 是否需要修改api-server API, 仅限饮食决策
  输出：
- 需要用户提供什么
- 需要如何修改API

---

# Step 2：核心用户流程设计（重点）

围绕最关键场景设计流程：

必须包含：

1. 用户饮食分析流程完善,覆盖决策系统所有信息

输出：

- 用户流程图（文字即可）

---

# Step 3：页面结构设计（可落地）

设计 Web 页面：

- 页面列表（如：首页 / 分析页 / 结果页 )
- 每个页面：
  - 功能
  - 数据来源 API
  - 用户操作

---

# Step 4：交互优化（关键）

不是做UI，而是优化“行为路径”：

例如：

- 优化收集步骤

---

# Step 5：UI结构设计（组件级）

输出：

- 页面组件拆分
- 每个组件的作用
- 状态来源（API / 本地状态）

---

# Step 6：API缺口识别

- 哪些交互做不了
- 是否需要新增 API或修改API
- 接口bug

---

# Step 7：分阶段迭代（非常重要）

设计：

Phase 1（可用）

- API 支持
- 档案字段
- 修复问题

Phase 2（优化体验）

- UI优化
- 交互优化

Phase 3（提升引导）
核心流程跑通

---

# 输出要求

- 强交互导向（不是纯UI）
- 每个页面必须对应API
- 可直接用于开发（React/Nextjs)





{
    "success": true,
    "code": 200,
    "message": "获取成功",
    "data": {
        "totalScore": 51,
        "breakdown": {
            "energy": 1.144003431201264,
            "proteinRatio": 78.69565217391303,
            "macroBalance": 86.75057208237986,
            "foodQuality": 57.81296526357757,
            "satiety": 57.81296526357757,
            "stability": 17,
            "glycemicImpact": 75,
            "mealQuality": 60
        },
        "highlights": [
            "⚠️ 热量不足 77%",
            "✅ 碳水达标"
        ],
        "decision": "LIMIT",
        "feedback": "热量、蛋白质、脂肪、碳水尚未达成平衡，建议按目标比例微调。",
        "goals": {
            "calories": 1938,
            "protein": 152,
            "fat": 47,
            "carbs": 227,
            "quality": 7,
            "satiety": 6
        },
        "intake": {
            "calories": 437,
            "protein": 19,
            "fat": 21,
            "carbs": 46
        },
        "statusLabel": "needs_improvement",
        "statusExplanation": {
            "text": "宏量状态：蛋白质不足、碳水偏低 ✅ 100%的餐食被评为健康。 💡 继续均衡饮食，注意下一餐的搭配。",
            "segments": [
                {
                    "type": "macro",
                    "text": "宏量状态：蛋白质不足、碳水偏低",
                    "sentiment": "warning"
                },
                {
                    "type": "meal_signal",
                    "text": "✅ 100%的餐食被评为健康。",
                    "sentiment": "positive"
                },
                {
                    "type": "tip",
                    "text": "💡 继续均衡饮食，注意下一餐的搭配。",
                    "sentiment": "neutral"
                }
            ]
        },
        "topStrength": {
            "dimension": "macroBalance",
            "score": 87
        },
        "topWeakness": {
            "dimension": "energy",
            "score": 1
        },
        "behaviorBonus": {
            "streakDays": 0,
            "complianceRate": 0,
            "bonusPoints": 0
        },
        "complianceInsight": {
            "calorieAdherence": 23,
            "proteinAdherence": 13,
            "fatAdherence": 45,
            "carbsAdherence": 20
        },
        "macroSlotStatus": {
            "calories": "deficit",
            "protein": "deficit",
            "fat": "ok",
            "carbs": "deficit",
            "dominantDeficit": "protein"
        },
        "issueHighlights": [
            {
                "type": "protein_deficit",
                "severity": "high",
                "message": "蛋白质摄入不足，仅达目标的13%"
            }
        ],
        "mealSignals": {
            "totalMeals": 1,
            "healthyMeals": 1,
            "healthyRatio": 1,
            "avgMealScore": 0,
            "decisionDistribution": {
                "safe": 1,
                "warn": 0,
                "stop": 0
            },
            "mealTypes": [
                "breakfast"
            ],
            "mealDiversity": 0.3333333333333333
        },
        "decisionAlignment": {
            "alignmentScore": 100,
            "deviationCount": 0,
            "deviationMeals": [],
            "summary": "1餐中1餐符合建议",
            "macroDeviations": [
                {
                    "macro": "calories",
                    "direction": "deficit",
                    "percent": 23,
                    "message": "热量仅达目标23%"
                },
                {
                    "macro": "protein",
                    "direction": "deficit",
                    "percent": 13,
                    "message": "蛋白质仅达目标13%"
                },
                {
                    "macro": "fat",
                    "direction": "deficit",
                    "percent": 45,
                    "message": "脂肪仅达目标45%"
                },
                {
                    "macro": "carbs",
                    "direction": "deficit",
                    "percent": 20,
                    "message": "碳水仅达目标20%"
                }
            ]
        },
        "weights": {
            "energy": 0.25,
            "proteinRatio": 0.2,
            "macroBalance": 0.1,
            "foodQuality": 0.05,
            "satiety": 0.05,
            "stability": 0.05,
            "glycemicImpact": 0.12,
            "mealQuality": 0.18
        },
        "weightsSource": "default",
        "dailyProgress": {
            "localHour": 11,
            "expectedProgress": 0.38,
            "actualProgress": 0.23,
            "isOnTrack": false
        }
    }
}
以上是http://localhost:3006/api/app/food/nutrition-score?_t=1776570806536

返回数据，根据数据帮我重构优化首页的今日状态和每日评分，可以合并成一个卡片“今日状态”, 然后根据后端能力持续迭代web项目，直到我主动中止
