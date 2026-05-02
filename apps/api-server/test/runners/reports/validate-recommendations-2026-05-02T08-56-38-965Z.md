# validate-recommendations

- generated: 2026-05-02T08:56:38.965Z
- duration: 18014 ms
- users: 12
- overall: **FAIL**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | PASS |
| V2 7d frequency cap (≤2) | FAIL (12) |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
(none)

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":4,"e2e-10-habit-cn@e2e.test":3,"e2e-11-habit-us@e2e.test":3,"e2e-12-habit-jp@e2e.test":3,"e2e-2-fat_loss-us@e2e.test":3,"e2e-3-fat_loss-jp@e2e.test":3}

| user | foodKey | count |
|---|---|---|
| e2e-1-fat_loss-cn@e2e.test | 587ef038-ea2f-4f06-b590-00b5ad112757 [Stir-fried Greens] | 3 |
| e2e-1-fat_loss-cn@e2e.test | 0ea3ce9d-0f29-462c-b5eb-5efd1a8ec221 [Stir-fried Lotus Root] | 3 |
| e2e-1-fat_loss-cn@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 [Wood Ear Mushroom Salad] | 4 |
| e2e-1-fat_loss-cn@e2e.test | 003628b0-1c2a-41a0-bc59-d7382a8ea0b0 [Steamed Eggplant with Garlic] | 3 |
| e2e-10-habit-cn@e2e.test | f048d5cc-0eb5-4bb8-9dca-2b41c1236c64 [Dry-Fried Green Beans] | 3 |
| e2e-10-habit-cn@e2e.test | 38622228-c1c7-44b8-a0c0-560e93f3407a [boiled noodles] | 3 |
| e2e-10-habit-cn@e2e.test | 5f92e57c-33bf-4805-9906-bb1d6b3b3c04 [Wood Ear Mushroom Salad] | 3 |
| e2e-11-habit-us@e2e.test | 1c31a84b-8835-4070-b80a-49b6e0fbd000 [Canned Whole Tomatoes] | 3 |
| e2e-12-habit-jp@e2e.test | 798e9d0f-4f86-4430-81ed-8fbb9bd33758 [Carrot] | 3 |
| e2e-2-fat_loss-us@e2e.test | 13bcedb2-a05e-4a11-b7e8-a1f436f4f9bb [cabbage] | 3 |
| e2e-3-fat_loss-jp@e2e.test | 09e90d54-e251-4032-a982-2446d6af4ada [tomato] | 3 |
| e2e-3-fat_loss-jp@e2e.test | e7872668-378b-4e16-8817-464550aac16a [lettuce] | 3 |

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
