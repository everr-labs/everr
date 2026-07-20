# TODO

## Ideas

- [**slo-sli-rollups**](todo/ideas/slo-sli-rollups.md) — Pre-aggregate simple `countIf`-style SLIs into time-bucketed rollups so budget and burn-rate windows read pre-summed buckets instead of rescanning raw telemetry each evaluation, letting us drop (or relax) the `/12` refresh throttle for those SLOs.

