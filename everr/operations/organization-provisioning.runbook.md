# Restore organization data access setup

This alert fires when at least one organization has waited two minutes for data access, or the dedicated worker has not reported health for two minutes. Health is computed from Postgres, so a ClickHouse stall does not prevent the app from recording it. Notification delivery still depends on the telemetry backend and its configured default notification channels.

## Determine the cause

The failure records below include organization, job, attempt, and trace identity. Check for ClickHouse timeouts or authentication failures, Postgres errors, startup failures, and exhausted jobs. Restore the failing dependency first. Automatic retries have a 30-second cap, and the worker supervisor retries startup failures every five seconds.

```panel
kind: Panel
height: 320
spec:
  display: { name: Setup failures and stalled organizations }
  plugin: { kind: Table, spec: {} }
  queries:
    - kind: ClickHouseSQL
      spec:
        plugin:
          kind: ClickHouseSQL
          spec:
            query: |
              SELECT Timestamp, SeverityText, Body,
                toString(LogAttributes.`everr.organization.id`) AS organization,
                toString(LogAttributes.`everr.worker.job.id`) AS job,
                toString(LogAttributes.`everr.worker.job.attempt`) AS attempt,
                toString(LogAttributes.`exception.message`) AS error,
                TraceId
              FROM logs
              WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                AND ServiceName = 'everr-dev-app'
                AND toString(ResourceAttributes.`deployment.environment.name`) = 'production'
                AND (startsWith(Body, 'clickhouse.organization.') OR Body = 'worker.runtime.failed')
              ORDER BY Timestamp DESC
              LIMIT 100
```

## Recovery

Provisioning is idempotent and marks readiness only after every DDL statement and an authentication probe succeeds. Leave the worker running after dependency recovery. The health snapshot returns to zero when setup completes, resolving the alert.

Inspect the public Postgres `graphile_worker.jobs` view for retry state. Exhausted jobs retain their last error; after fixing the cause, use Graphile's `reschedule_jobs` with an attempt count of zero and a run time of now.

Normal SIGTERM and SIGINT drain both workers before telemetry shuts down. A hard kill can leave Graphile locks for four hours. Identify the worker IDs of the terminated process from its worker job logs or the job view. Only after confirming those workers are dead, use Graphile's public `force_unlock_workers` for those IDs. Do not release locks owned by a live process. Restarting a healthy worker then brings long retry schedules forward. This is the explicit recovery procedure for hard kills, not an instruction to unlock every worker.

Organization deletion records its cleanup job in the same transaction as deleting the organization and its Postgres data. Retrying ClickHouse cleanup is safe even if some statements already succeeded. The removed organization cannot lose its cleanup intent through a later hook failure.
