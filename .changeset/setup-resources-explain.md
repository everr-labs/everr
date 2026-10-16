---
"@everr/cli": patch
---

The `everr-setup-resources` skill now checks each panel and alert query with `EXPLAIN indexes = 1` and `EXPLAIN ESTIMATE` over the long range, and filters on the table's leading sort-key columns until it reads fewer granules.
