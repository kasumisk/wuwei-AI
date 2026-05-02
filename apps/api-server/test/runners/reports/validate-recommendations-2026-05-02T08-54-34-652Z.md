# validate-recommendations

- generated: 2026-05-02T08:54:34.652Z
- duration: 6546 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | PASS |
| V2 7d frequency cap (≤2) | FAIL (14) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
(none)

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":4,"e2e-10-habit-cn@e2e.test":3,"e2e-11-habit-us@e2e.test":3,"e2e-12-habit-jp@e2e.test":4,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":3}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | d92c7b2d-f637-4208-93fe-58da5728278e | 3 |
| e2e-1-fat_loss-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 | 4 |
| e2e-1-fat_loss-cn@e2e.test | dd63dfd7-e90a-486c-8be8-33e4d9e2cb60 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 77187892-9f8a-49e2-84df-b7fd63554e97 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 3 |
| e2e-10-habit-cn@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 | 3 |
| e2e-11-habit-us@e2e.test | 901b9624-7a5d-4e4e-87d5-6ff4ac9aa898 | 3 |
| e2e-11-habit-us@e2e.test | 16864e31-3d37-4923-b73e-a772a316fa94 | 3 |
| e2e-12-habit-jp@e2e.test | 798e9d0f-4f86-4430-81ed-8fbb9bd33758 | 4 |
| e2e-2-fat_loss-us@e2e.test | 16864e31-3d37-4923-b73e-a772a316fa94 | 3 |
| e2e-2-fat_loss-us@e2e.test | 4c5a2601-b927-4be2-8143-8cdcb4428406 | 3 |
| e2e-2-fat_loss-us@e2e.test | 4f470710-cff2-4569-973a-972c53c6e8e6 | 3 |
| e2e-3-fat_loss-jp@e2e.test | e7872668-378b-4e16-8817-464550aac16a | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
