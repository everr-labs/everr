Reset all workflow data from Postgres, pg-boss, and ClickHouse.

Run the following commands:

```sh
docker exec everr-postgres-1 psql -U postgres -c "TRUNCATE workflow_jobs, workflow_runs CASCADE;"
docker exec everr-postgres-1 psql -U postgres -c "DELETE FROM pgboss.job;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.traces;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.cdevents;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.logs;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.metrics_gauge;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.metrics_sum;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.workflow_resource_usage_samples;"
docker exec everr-clickhouse-1 clickhouse-client --query "TRUNCATE TABLE app.workflow_resource_usage_job_summaries;"
```

Report what was deleted.
