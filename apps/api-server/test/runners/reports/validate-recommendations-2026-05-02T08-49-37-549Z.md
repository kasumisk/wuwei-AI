# validate-recommendations

- generated: 2026-05-02T08:49:37.549Z
- duration: 6238 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | FAIL (44) |
| V2 7d frequency cap (≤2) | FAIL (12) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
| user | region | meal | food | cuisine | foodCountries | allowed |
|---|---|---|---|---|---|---|
| e2e-11-habit-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | lunch | 干煸四季豆 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 醋溜土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-12-habit-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 清炒山药 | chinese | CN | JP |
| e2e-2-fat_loss-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | lunch | 红烧茄子 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 清炒山药 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 蒜苗炒肉 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-3-fat_loss-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 虎皮青椒 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 蒜蓉西兰花 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-5-muscle_gain-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | lunch | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 拍黄瓜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-6-muscle_gain-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 蒜蓉西兰花 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 蒜苗炒肉 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 鱼排 | western | US,GB,FR,DE,IT,ES | JP |
| e2e-8-health-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | lunch | 干煸四季豆 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 干煸四季豆 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 蒜蓉西兰花 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-9-health-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | dinner | 醋溜土豆丝 | chinese | CN | JP |

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":4,"e2e-10-habit-cn@e2e.test":3,"e2e-11-habit-us@e2e.test":3,"e2e-12-habit-jp@e2e.test":2,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":3}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 77187892-9f8a-49e2-84df-b7fd63554e97 | 3 |
| e2e-1-fat_loss-cn@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 3e595a05-1e12-4757-bba1-748efe699dce | 4 |
| e2e-1-fat_loss-cn@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 4 |
| e2e-10-habit-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 3 |
| e2e-11-habit-us@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-11-habit-us@e2e.test | 38622228-c1c7-44b8-a0c0-560e93f3407a | 3 |
| e2e-2-fat_loss-us@e2e.test | e5a3de67-b79b-49f5-8b23-6ac8b52556b4 | 3 |
| e2e-2-fat_loss-us@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 3 |
| e2e-3-fat_loss-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
