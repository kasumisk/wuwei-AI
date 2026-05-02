# validate-recommendations

- generated: 2026-05-02T08:48:32.658Z
- duration: 5490 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | FAIL (45) |
| V2 7d frequency cap (≤2) | FAIL (12) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
| user | region | meal | food | cuisine | foodCountries | allowed |
|---|---|---|---|---|---|---|
| e2e-11-habit-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | lunch | 醋溜土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 红烧茄子 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-12-habit-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 醋溜土豆丝 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 拍黄瓜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-2-fat_loss-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | lunch | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 醋溜土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-3-fat_loss-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 蒜苗炒肉 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 家常豆腐 | chinese | CN | JP |
| e2e-5-muscle_gain-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | lunch | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 酸辣土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-6-muscle_gain-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 蒜苗炒肉 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 炒青菜 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 鱼排 | western | US,GB,FR,DE,IT,ES | JP |
| e2e-8-health-us@e2e.test | US | breakfast | 卷饼（鸡肉） | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | lunch | 蒜蓉西兰花 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 炒青菜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 拍黄瓜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-9-health-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | dinner | 炒青菜 | chinese | CN | JP |

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":4,"e2e-10-habit-cn@e2e.test":4,"e2e-11-habit-us@e2e.test":3,"e2e-12-habit-jp@e2e.test":3,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":3}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-1-fat_loss-cn@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 4 |
| e2e-1-fat_loss-cn@e2e.test | 1b095110-c08c-440b-a8d3-ddd6d48f0079 | 3 |
| e2e-10-habit-cn@e2e.test | 77187892-9f8a-49e2-84df-b7fd63554e97 | 4 |
| e2e-11-habit-us@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-12-habit-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-12-habit-jp@e2e.test | 9f1e05b5-2533-45d2-9887-24be305c11a7 | 3 |
| e2e-2-fat_loss-us@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 3 |
| e2e-2-fat_loss-us@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-3-fat_loss-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
