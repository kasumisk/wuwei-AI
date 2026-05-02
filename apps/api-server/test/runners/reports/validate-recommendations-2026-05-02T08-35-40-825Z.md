# validate-recommendations

- generated: 2026-05-02T08:35:40.825Z
- duration: 7187 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | FAIL (46) |
| V2 7d frequency cap (≤2) | FAIL (69) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
| user | region | meal | food | cuisine | foodCountries | allowed |
|---|---|---|---|---|---|---|
| e2e-11-habit-us@e2e.test | US | breakfast | 煮面条 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | lunch | 拍黄瓜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 蒜蓉西兰花 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-11-habit-us@e2e.test | US | dinner | 干煸四季豆 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-12-habit-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 手撕包菜 | chinese | CN | JP |
| e2e-12-habit-jp@e2e.test | JP | dinner | 豆浆(甜) | chinese | CN | JP |
| e2e-2-fat_loss-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | lunch | 酸辣土豆丝 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 蒜苗炒肉 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-2-fat_loss-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-3-fat_loss-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 干煸四季豆 | chinese | CN | JP |
| e2e-3-fat_loss-jp@e2e.test | JP | dinner | 豆浆(甜) | chinese | CN | JP |
| e2e-5-muscle_gain-us@e2e.test | US | breakfast | 西红柿炒鸡蛋 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | lunch | 虎皮青椒 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-5-muscle_gain-us@e2e.test | US | dinner | 干煸四季豆 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-6-muscle_gain-jp@e2e.test | JP | breakfast | 西红柿炒鸡蛋 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 麻婆豆腐 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 炒豆芽 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 豆腐卷 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 炒豆芽 | chinese | CN | JP |
| e2e-6-muscle_gain-jp@e2e.test | JP | dinner | 鱼排 | western | US,GB,FR,DE,IT,ES | JP |
| e2e-8-health-us@e2e.test | US | breakfast | 鸡蛋汤 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | lunch | 炒青菜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 炒豆芽 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-8-health-us@e2e.test | US | dinner | 地三鲜 | chinese | CN | US,GB,FR,DE,IT,ES,MX |
| e2e-9-health-jp@e2e.test | JP | breakfast | 煮面条 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒饭（蛋炒饭） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 烧腊饭（叉烧） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 炒青菜 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | lunch | 盖浇饭（鱼香肉丝） | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | dinner | 蒜蓉西兰花 | chinese | CN | JP |
| e2e-9-health-jp@e2e.test | JP | dinner | 干煸四季豆 | chinese | CN | JP |

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":9,"e2e-10-habit-cn@e2e.test":5,"e2e-11-habit-us@e2e.test":7,"e2e-12-habit-jp@e2e.test":8,"e2e-2-fat_loss-us@e2e.test":9,"e2e-3-fat_loss-jp@e2e.test":12}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 603efd61-0d7f-499f-8b36-878862a26df9 | 6 |
| e2e-1-fat_loss-cn@e2e.test | 2c540658-ddf4-45ed-a0da-871475b9aaa6 | 6 |
| e2e-1-fat_loss-cn@e2e.test | b760d6c3-4259-4498-8e1d-c1eb8c5d0d8c | 7 |
| e2e-1-fat_loss-cn@e2e.test | 77187892-9f8a-49e2-84df-b7fd63554e97 | 6 |
| e2e-1-fat_loss-cn@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 6 |
| e2e-1-fat_loss-cn@e2e.test | e074fc1b-5133-435d-9d37-257b14d30815 | 3 |
| e2e-1-fat_loss-cn@e2e.test | d6e1c7e0-6c0e-451c-8cea-ebd3333cb678 | 5 |
| e2e-1-fat_loss-cn@e2e.test | 05093e6f-ccc6-44a7-882e-2ce0144c92f5 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 83a717f4-7972-4643-b676-a5acce7b8201 | 6 |
| e2e-1-fat_loss-cn@e2e.test | 38622228-c1c7-44b8-a0c0-560e93f3407a | 4 |
| e2e-1-fat_loss-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 9 |
| e2e-1-fat_loss-cn@e2e.test | d92c7b2d-f637-4208-93fe-58da5728278e | 4 |
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 | 4 |
| e2e-10-habit-cn@e2e.test | b760d6c3-4259-4498-8e1d-c1eb8c5d0d8c | 5 |
| e2e-10-habit-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 5 |
| e2e-10-habit-cn@e2e.test | 83a717f4-7972-4643-b676-a5acce7b8201 | 5 |
| e2e-10-habit-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 3 |
| e2e-10-habit-cn@e2e.test | f048d5cc-0eb5-4bb8-9dca-2b41c1236c64 | 3 |
| e2e-10-habit-cn@e2e.test | 2c540658-ddf4-45ed-a0da-871475b9aaa6 | 5 |
| e2e-10-habit-cn@e2e.test | d6e1c7e0-6c0e-451c-8cea-ebd3333cb678 | 4 |
| e2e-10-habit-cn@e2e.test | 3e595a05-1e12-4757-bba1-748efe699dce | 3 |
| e2e-10-habit-cn@e2e.test | 55a1f286-0bfc-42a6-8b76-9ee9c2253030 | 3 |
| e2e-10-habit-cn@e2e.test | 38622228-c1c7-44b8-a0c0-560e93f3407a | 3 |
| e2e-11-habit-us@e2e.test | 501d5354-e532-4dcd-b82e-1a5fcf0fc835 | 3 |
| e2e-11-habit-us@e2e.test | 901b9624-7a5d-4e4e-87d5-6ff4ac9aa898 | 7 |
| e2e-11-habit-us@e2e.test | 0aae89b3-d174-4094-9d35-701c555571fe | 4 |
| e2e-11-habit-us@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 7 |
| e2e-11-habit-us@e2e.test | de47e8f2-113f-4698-a0e3-308e0e585911 | 4 |
| e2e-11-habit-us@e2e.test | e1694480-bcc5-4517-8bdb-344c8245c329 | 3 |
| e2e-11-habit-us@e2e.test | e5a3de67-b79b-49f5-8b23-6ac8b52556b4 | 4 |
| e2e-11-habit-us@e2e.test | 0f6111cd-c7d0-4dbf-85dd-4976d4268e77 | 4 |
| e2e-11-habit-us@e2e.test | 100d6200-6ecd-489e-a08c-76064cf74d83 | 3 |
| e2e-11-habit-us@e2e.test | 6a67a8b0-a417-4476-8d83-06f82bdb7ce2 | 4 |
| e2e-11-habit-us@e2e.test | 33e852be-f9ef-4253-980d-26311d037ac3 | 3 |
| e2e-12-habit-jp@e2e.test | ae4cbc06-fb3c-4545-a795-bd31fd27b7ad | 3 |
| e2e-12-habit-jp@e2e.test | 868d9500-70b4-4acb-9220-81bcb111505a | 5 |
| e2e-12-habit-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 8 |
| e2e-12-habit-jp@e2e.test | 3ae80937-2692-4866-858d-0af788ee16e8 | 6 |
| e2e-12-habit-jp@e2e.test | b760d6c3-4259-4498-8e1d-c1eb8c5d0d8c | 5 |
| e2e-12-habit-jp@e2e.test | 901b9624-7a5d-4e4e-87d5-6ff4ac9aa898 | 6 |
| e2e-12-habit-jp@e2e.test | 6d217f67-c31f-45b4-8093-e74c56a3f61b | 3 |
| e2e-12-habit-jp@e2e.test | 33e852be-f9ef-4253-980d-26311d037ac3 | 3 |
| e2e-12-habit-jp@e2e.test | f2ab3921-cba8-4f48-8599-2c9242fc99e1 | 3 |
| e2e-12-habit-jp@e2e.test | 5e35e557-f548-49e3-a797-7af0d263c07c | 3 |
| e2e-2-fat_loss-us@e2e.test | 6a67a8b0-a417-4476-8d83-06f82bdb7ce2 | 6 |
| e2e-2-fat_loss-us@e2e.test | 501d5354-e532-4dcd-b82e-1a5fcf0fc835 | 3 |
| e2e-2-fat_loss-us@e2e.test | e5a3de67-b79b-49f5-8b23-6ac8b52556b4 | 5 |
| e2e-2-fat_loss-us@e2e.test | 901b9624-7a5d-4e4e-87d5-6ff4ac9aa898 | 8 |
| e2e-2-fat_loss-us@e2e.test | d51b059e-40b2-48e4-9e2d-144d9ad8c56e | 7 |
| e2e-2-fat_loss-us@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 9 |
| e2e-2-fat_loss-us@e2e.test | 2c540658-ddf4-45ed-a0da-871475b9aaa6 | 4 |
| e2e-2-fat_loss-us@e2e.test | 1ad086ce-36d5-4839-997d-ed0adb553dad | 3 |
| e2e-2-fat_loss-us@e2e.test | 38622228-c1c7-44b8-a0c0-560e93f3407a | 3 |
| e2e-2-fat_loss-us@e2e.test | 100d6200-6ecd-489e-a08c-76064cf74d83 | 3 |
| e2e-2-fat_loss-us@e2e.test | 868d9500-70b4-4acb-9220-81bcb111505a | 5 |
| e2e-2-fat_loss-us@e2e.test | b760d6c3-4259-4498-8e1d-c1eb8c5d0d8c | 4 |
| e2e-3-fat_loss-jp@e2e.test | 3ae80937-2692-4866-858d-0af788ee16e8 | 5 |
| e2e-3-fat_loss-jp@e2e.test | 868d9500-70b4-4acb-9220-81bcb111505a | 6 |
| e2e-3-fat_loss-jp@e2e.test | 2781fa11-77f6-43b2-a49f-e7519fb51542 | 6 |
| e2e-3-fat_loss-jp@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 12 |
| e2e-3-fat_loss-jp@e2e.test | bb0e32fe-6b8b-4e18-b18c-5fc7abae3478 | 3 |
| e2e-3-fat_loss-jp@e2e.test | b760d6c3-4259-4498-8e1d-c1eb8c5d0d8c | 5 |
| e2e-3-fat_loss-jp@e2e.test | d51b059e-40b2-48e4-9e2d-144d9ad8c56e | 4 |
| e2e-3-fat_loss-jp@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 5 |
| e2e-3-fat_loss-jp@e2e.test | 901b9624-7a5d-4e4e-87d5-6ff4ac9aa898 | 3 |
| e2e-3-fat_loss-jp@e2e.test | 603efd61-0d7f-499f-8b36-878862a26df9 | 4 |
| e2e-3-fat_loss-jp@e2e.test | 2c540658-ddf4-45ed-a0da-871475b9aaa6 | 4 |
| e2e-3-fat_loss-jp@e2e.test | 1ad086ce-36d5-4839-997d-ed0adb553dad | 3 |
| e2e-3-fat_loss-jp@e2e.test | a39a05ff-7306-4a55-9ebf-a4efe7c3eb06 | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
