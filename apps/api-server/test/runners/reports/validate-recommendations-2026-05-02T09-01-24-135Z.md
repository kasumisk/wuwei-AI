# validate-recommendations

- generated: 2026-05-02T09:01:24.135Z
- duration: 6905 ms
- users: 12
- overall: **PASS**

## Summary
| invariant | result |
|---|---|
| V1 cross-region cuisine | PASS |
| V2 7d frequency cap (≤2) | PASS |
| V3 canCook=false channels | PASS |
| V4 invalid tz fallback | PASS |

## V1 cross-region cuisine
(none)

## V2 7-day frequency cap
per-user max counts: {"e2e-1-fat_loss-cn@e2e.test":2,"e2e-10-habit-cn@e2e.test":1,"e2e-11-habit-us@e2e.test":2,"e2e-12-habit-jp@e2e.test":2,"e2e-2-fat_loss-us@e2e.test":2,"e2e-3-fat_loss-jp@e2e.test":1}

(none)

## V3 canCook=false channels
(none)

## V4 invalid timezone fallback
(all OK)
