## What

ClickHouse table TTLs need to be reviewed and tuned. Currently unclear if TTLs are set at all, or if data is retained indefinitely.

## Where

ClickHouse `app.*` tables (traces, logs, cdevents, metrics_gauge, metrics_sum, workflow_resource_usage_samples, workflow_resource_usage_job_summaries).

## Steps to reproduce

N/A

## Expected

Tables should have appropriate TTLs based on data usage patterns (e.g. 90 days for traces/logs, longer for aggregated summaries).

## Actual

unknown

## Priority

medium

## Notes

- Dashboard queries typically look back 7–90 days. Data older than that is rarely accessed.
- Without TTLs, disk usage grows unbounded per tenant.
- Consider different retention periods per table: raw logs/traces shorter, aggregated summaries longer.
