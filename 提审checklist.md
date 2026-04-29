下面给你一份**针对你这个 EatCheck（AI饮食健康 + 订阅 + Firebase + 匿名登录 + 可能AI建议）**的 **Apple App Store 提审完整 Checklist（实战版）**。我按“能不能过审”优先级整理，不是理论清单。

---

# ✅ EatCheck App Store 提审 Checklist（完整实战版）

---

# 🟢 一、基础信息（必须全部正确）

## 1. App Store Connect 信息

* [ ] App 名称（唯一、不侵权）
* [ ] 副标题（清晰功能描述，不夸大）
* [ ] 描述（真实，不承诺医疗效果）
* [ ] Keywords（避免 medical / cure / diagnose）
* [ ] Support URL（必须可访问）
* [ ] Privacy Policy URL（必须）
* [ ] Marketing URL（建议有）

---

## 2. 分类选择

* [ ] Primary Category：Health & Fitness 或 Food & Drink（建议 Health & Fitness）
* [ ] Secondary Category（可选）

---

# 🟢 二、隐私与合规（非常关键）

## 3. Privacy Policy（必须可访问）

必须包含：

* [ ] 收集数据类型

  * 饮食记录
  * 使用数据
  * 账号信息（如果有）

* [ ] 数据用途说明

  * AI分析
  * 个性化建议
  * 功能优化

* [ ] 数据是否共享（必须明确）

  * ✔ 不出售数据（建议写 NO SELLING DATA）

* [ ] 用户权利

  * 删除数据
  * 导出数据（建议）

* [ ] 联系方式

---

## 4. App Privacy（App Store Connect）

必须一致：

* [ ] 是否收集数据（YES/NO一致）
* [ ] 是否用于 tracking（通常 NO）
* [ ] 是否关联身份（匿名登录要特别注意）
* [ ] 是否用于广告（通常 NO）

⚠️ 常见挂点：

> Firebase + anonymous login 没标清楚 → 审核会卡

---

## 5. “Not Medical Advice”（必须）

必须出现至少3个位置：

* [ ] App 内设置页
* [ ] 官网
* [ ] 隐私政策

标准文案：

> This app does not provide medical advice.
> All insights are for informational purposes only and should not replace professional medical consultation.

---

# 🟢 三、功能与行为审核（核心）

## 6. 登录系统（你这个很关键）

你说你是：

> 匿名登录 → 后面升级邮箱账号

必须检查：

* [ ] 可以完全匿名使用基础功能
* [ ] 不强制注册才能使用核心功能（⚠️重点）
* [ ] upgrade 账号流程清晰
* [ ] 没有“功能锁死在登录后”

⚠️ Apple 常见拒绝理由：

> App requires login to access basic functionality

---

## 7. 订阅系统（RevenueCat / IAP）

必须确认：

* [ ] 免费功能明确
* [ ] 付费功能清晰
* [ ] 恢复购买（Restore Purchases）
* [ ] 取消订阅说明（Apple 强制）

必须具备：

* [ ] 订阅页有价格说明
* [ ] 自动续费说明
* [ ] 用户可恢复订阅

⚠️ 常见拒绝：

* Missing metadata
* Cannot verify purchase
* No restore button

---

## 8. AI 功能（重点风险）

你的 App 属于：

👉 AI health suggestion（高审查敏感区）

必须避免：

* ❌ “diagnose disease”
* ❌ “treat illness”
* ❌ “medical recommendation”

必须保证：

* [ ] AI 输出是 nutrition insights
* [ ] 不涉及疾病判断
* [ ] 有免责声明

---

# 🟢 四、技术与稳定性

## 9. App 稳定性

* [ ] 无 crash
* [ ] 登录流程可用
* [ ] 订阅流程可走完（Sandbox）
* [ ] 网络失败有 fallback
* [ ] API key 不泄露

---

## 10. Firebase / 后端

* [ ] API 不暴露敏感 key
* [ ] HTTPS 全部开启
* [ ] 用户数据可删除（最好支持）

---

# 🟢 五、UI/UX（审核常看）

* [ ] 首页能看懂 App 做什么
* [ ] 没有空页面 / 404
* [ ] 没有“beta / debug UI”
* [ ] 没有 placeholder 文案（如 lorem ipsum）
* [ ] 有基础引导（onboarding）

---

# 🟢 六、App Store 元数据（很容易挂）

## 11. 截图

* [ ] iPhone 6.7 / 6.5 / 5.5 全尺寸
* [ ] 展示真实功能
* [ ] 不夸大（no “cure”, “doctor replacement”）

---

## 12. Icon

* [ ] 1024x1024 PNG（不能 SVG）
* [ ] 无透明背景
* [ ] 无模糊

---

## 13. 版本信息

* [ ] Version / Build 正确
* [ ] Release notes 写清楚（不要写 debug）

---

# 🟢 七、Support URL（你问的重点）

必须满足：

* [ ] 可访问（200 OK）
* [ ] 有内容（不能空）
* [ ] 包含：

  * App介绍
  * 联系方式
  * Privacy Policy
  * Terms
  * Not medical disclaimer

👉 ❗建议：**必须做官网，不要只填空链接**

---

# 🟡 八、常见拒绝原因（你这个 App 特别相关）

你很容易踩这些：

### ❌ 1. Missing Metadata

* IAP 没验证
* 订阅没 sandbox 测试成功

### ❌ 2. Guideline 4.2（最常见）

* App 太空
* 没官网
* 没支持信息

### ❌ 3. Medical claim

* AI 建议像医疗建议

### ❌ 4. Login required

* 不登录不能用核心功能

---

# 🟢 九、最终提审前检查（最重要）

在点 Submit 前确认：

* [ ] Support URL 可打开
* [ ] Privacy Policy 可打开
* [ ] Terms 可打开
* [ ] IAP 可测试购买
* [ ] Restore Purchase 可用
* [ ] App 不 crash
* [ ] AI 不涉及医疗诊断
* [ ] 没 debug UI
* [ ] 没空页面

---

# 🚀 一句话总结（关键）

你这个 App 过审关键不在代码，而在：

> “你是否像一个真实、合规、可支持用户的产品”

---

# 如果你下一步要做，我可以帮你：

✔ 帮你做「Apple审核100%合规官网模板」
✔ 帮你改 Privacy Policy（符合欧美标准）
✔ 帮你改 AI 输出避免被判 medical app
✔ 帮你排查 RevenueCat / IAP 过审问题

直接说一句：
👉 **“帮我做审核强化版本”**
