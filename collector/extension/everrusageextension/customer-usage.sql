-- Canonical customer-visible usage total for the half-open UTC period [from, to).
-- Tenant isolation is enforced by the query user's row-level policy.
-- Owner equality excludes administrative copies when querying across tenants.
SELECT customer, signal, sum(toDecimal128(bytes, 0)) AS bytes
FROM
(
    SELECT
        Attributes['everr.usage.tenant.id'] AS customer,
        Attributes['everr.ingestion.signal'] AS signal,
        ResourceAttributes['service.instance.id'] AS instance,
        Attributes['everr.usage.sequence'] AS sequence,
        min(Value) AS bytes
    FROM metrics_sum
    WHERE ServiceName = 'everr-ingestion'
      AND MetricName = 'everr.ingestion.volume'
      AND TimeUnix >= {from:DateTime}
      AND TimeUnix < {to:DateTime}
      AND ResourceAttributes['everr.tenant.id'] = Attributes['everr.usage.tenant.id']
      AND notEmpty(ResourceAttributes['service.instance.id'])
      AND notEmpty(Attributes['everr.usage.sequence'])
      AND notEmpty(Attributes['everr.usage.tenant.id'])
      AND Attributes['everr.ingestion.signal'] IN ('logs', 'traces', 'metrics')
    GROUP BY customer, signal, instance, sequence
)
GROUP BY customer, signal
ORDER BY customer, signal
