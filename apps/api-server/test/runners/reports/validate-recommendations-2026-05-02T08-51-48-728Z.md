# validate-recommendations

- generated: 2026-05-02T08:51:48.728Z
- duration: 7572 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | FAIL (46) |
| V2 7d frequency cap (≤2) | FAIL (9) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
| user | region | meal | food | cuisine | foodCountries | allowed |
|---|---|---|---|---|---|---|
| e2e-11-habit-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | lunch | 蒜苗炒肉 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 炒青菜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 醋溜土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-12-habit-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 醋溜土豆丝 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 拍黄瓜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-2-fat_loss-us@e2e.test | US | breakfast | 鸡蛋汤 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | lunch | 凉拌木耳 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 手撕包菜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-3-fat_loss-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 拍黄瓜 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 小豆粥 | chinese | CN | JP |
| e2e-5-muscle_gain-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | lunch | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 拍黄瓜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-6-muscle_gain-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 醋溜土豆丝 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 鱼排 | western | US,GB,FR,DE,IT,ES | JP |
| e2e-8-health-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | lunch | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 蒜苗炒肉 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-9-health-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | dinner | 清炒山药 | chinese | CN | JP |

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":3,"e2e-10-habit-cn@e2e.test":3,"e2e-11-habit-us@e2e.test":2,"e2e-12-habit-jp@e2e.test":3,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":3}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 003628b0-1c2a-41a0-bc59-d7382a8ea0b0 | 3 |
| e2e-1-fat_loss-cn@e2e.test | bb0e32fe-6b8b-4e18-b18c-5fc7abae3478 | 3 |
| e2e-10-habit-cn@e2e.test | e9b7e7e0-57e3-431e-a66b-4efa05ff45e4 | 3 |
| e2e-10-habit-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 3 |
| e2e-12-habit-jp@e2e.test | f048d5cc-0eb5-4bb8-9dca-2b41c1236c64 | 3 |
| e2e-2-fat_loss-us@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 | 3 |
| e2e-3-fat_loss-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
