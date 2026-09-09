-- Canonical customer-visible usage for one UTC calendar month (YYYY-MM).
-- Run after the month ends and pending writes have settled to finalize invoices.
-- Tenant isolation is enforced by the query user's row-level policy.
SELECT customer, signal, sum(bytes) AS bytes
FROM
(
    SELECT
        Attributes['everr.usage.tenant.id'] AS customer,
        Attributes['everr.ingestion.signal'] AS signal,
        ResourceAttributes['service.instance.id'] AS instance,
        StartTimeUnix AS counter_start,
        -- Float64 stores integers exactly through 2^53. Larger positive Int64
        -- counters can round up by at most 1024 bytes; subtract that bound.
        toDecimal128(max(Value), 0)
            - if(max(Value) > 9007199254740992, 1024, 0) AS bytes
    FROM metrics_sum
    WHERE ServiceName = 'everr-ingestion'
      AND MetricName = 'everr.ingestion.volume'
      AND Attributes['everr.usage.month'] = {month:String}
      AND TimeUnix >= toDateTime(concat({month:String}, '-01 00:00:00'), 'UTC')
      AND AggregationTemporality = 2
      AND ResourceAttributes['everr.tenant.id'] = Attributes['everr.usage.tenant.id']
      AND notEmpty(ResourceAttributes['service.instance.id'])
      AND notEmpty(Attributes['everr.usage.tenant.id'])
      AND Attributes['everr.ingestion.signal'] IN ('logs', 'traces', 'metrics')
      AND Value >= 0
    GROUP BY customer, signal, instance, counter_start
)
GROUP BY customer, signal
ORDER BY customer, signal
