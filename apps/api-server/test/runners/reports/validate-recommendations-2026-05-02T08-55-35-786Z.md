# validate-recommendations

- generated: 2026-05-02T08:55:35.786Z
- duration: 7054 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | PASS |
| V2 7d frequency cap (≤2) | FAIL (13) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
(none)

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":3,"e2e-10-habit-cn@e2e.test":3,"e2e-11-habit-us@e2e.test":3,"e2e-12-habit-jp@e2e.test":3,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":4}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 2c540658-ddf4-45ed-a0da-871475b9aaa6 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 77187892-9f8a-49e2-84df-b7fd63554e97 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 1bef167b-499d-47b9-a776-4918fef60953 | 3 |
| e2e-1-fat_loss-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 | 3 |
| e2e-10-habit-cn@e2e.test | f048d5cc-0eb5-4bb8-9dca-2b41c1236c64 | 3 |
| e2e-11-habit-us@e2e.test | 798e9d0f-4f86-4430-81ed-8fbb9bd33758 | 3 |
| e2e-12-habit-jp@e2e.test | 38a55fbd-4df4-41c2-b6a4-cb2e551755f5 | 3 |
| e2e-12-habit-jp@e2e.test | 798e9d0f-4f86-4430-81ed-8fbb9bd33758 | 3 |
| e2e-2-fat_loss-us@e2e.test | 16864e31-3d37-4923-b73e-a772a316fa94 | 3 |
| e2e-3-fat_loss-jp@e2e.test | 16864e31-3d37-4923-b73e-a772a316fa94 | 4 |
| e2e-3-fat_loss-jp@e2e.test | 09e90d54-e251-4032-a982-2446d6af4ada | 3 |
| e2e-3-fat_loss-jp@e2e.test | 798e9d0f-4f86-4430-81ed-8fbb9bd33758 | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
