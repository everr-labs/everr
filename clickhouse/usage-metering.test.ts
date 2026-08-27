import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClickHouseClient,
  type ClickHouseSettings,
  createClient,
} from "@clickhouse/client";
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:26.2";
const ADMIN_PASSWORD = "everr";
const VALIDATION_RUN_ID = "usage-metering-test-fixture";
const USAGE_MIGRATION_FILE = "13-create-usage-metering.sql";
const USAGE_MIGRATION_PREFIX = "13";
const USAGE_MIGRATION_CONTAINER_PATH = `/tmp/${USAGE_MIGRATION_FILE}`;
const TELEMETRY_FIXTURE_CONTAINER_PATH = "/tmp/usage-metering-signals.sql";
const VALIDATION_RUN_ID_PLACEHOLDER = "__VALIDATION_RUN_ID__";

const clickhouseDirectory = fileURLToPath(new URL(".", import.meta.url));
const initDirectory = path.join(clickhouseDirectory, "init");

const collectorSettings = {
  async_insert: 1,
  wait_for_async_insert: 1,
  deduplicate_blocks_in_dependent_materialized_views: 1,
  materialized_views_ignore_errors: 0,
  asterisk_include_materialized_columns: 0,
} satisfies ClickHouseSettings;

let container: StartedClickHouseContainer;
let admin: ClickHouseClient;
let collector: ClickHouseClient;
let appReader: ClickHouseClient;
let webAppAdmin: ClickHouseClient;

type ScalarExpectation = readonly [
  label: string,
  query: string,
  expected: string,
];

async function discoverPreFeatureInitFiles() {
  const entries = await readdir(initDirectory, { withFileTypes: true });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(USAGE_MIGRATION_PREFIX) &&
        (entry.name.endsWith(".sh") || entry.name.endsWith(".sql")),
    )
    .map((entry) => entry.name)
    .sort();
}

function createUserClient(
  username: string,
  password: string,
  clickhouseSettings?: ClickHouseSettings,
) {
  return createClient({
    url: container.getHttpUrl(),
    username,
    password,
    database: "default",
    application: "everr_usage_metering_test",
    clickhouse_settings: clickhouseSettings,
  });
}

async function scalar(client: ClickHouseClient, query: string) {
  const result = await client.query({
    query,
    format: "TabSeparatedRaw",
  });
  return (await result.text()).trim();
}

async function expectScalar(
  client: ClickHouseClient,
  label: string,
  query: string,
  expected: string,
) {
  expect(await scalar(client, query), label).toBe(expected);
}

async function expectScalars(
  client: ClickHouseClient,
  expectations: ScalarExpectation[],
) {
  await Promise.all(
    expectations.map(([label, query, expected]) =>
      expectScalar(client, label, query, expected),
    ),
  );
}

async function execute(client: ClickHouseClient, query: string) {
  await client.command({ query });
}

async function executeSqlFile({
  user,
  password,
  file,
  settings = [],
}: {
  user: string;
  password: string;
  file: string;
  settings?: string[];
}) {
  const result = await container.exec([
    "clickhouse-client",
    "--user",
    user,
    "--password",
    password,
    ...settings,
    "--multiquery",
    "--queries-file",
    file,
  ]);

  expect(result.exitCode, result.output).toBe(0);
}

async function applyUsageMetering() {
  await executeSqlFile({
    user: "default",
    password: ADMIN_PASSWORD,
    file: USAGE_MIGRATION_CONTAINER_PATH,
  });
}

async function validateCollectorSettings() {
  await expectScalars(collector, [
    [
      "explicit UTC DateTime",
      "SELECT toTypeName(now('UTC'))",
      "DateTime('UTC')",
    ],
    [
      "collector materialized columns excluded from wildcard reads",
      "SELECT value FROM system.settings WHERE name = 'asterisk_include_materialized_columns'",
      "0",
    ],
    [
      "collector materialized view errors enabled",
      "SELECT value FROM system.settings WHERE name = 'materialized_views_ignore_errors'",
      "0",
    ],
    [
      "collector async inserts enabled",
      "SELECT value FROM system.settings WHERE name = 'async_insert'",
      "1",
    ],
    [
      "collector waits for async inserts",
      "SELECT value FROM system.settings WHERE name = 'wait_for_async_insert'",
      "1",
    ],
    [
      "collector dependent view deduplication enabled",
      "SELECT value FROM system.settings WHERE name = 'deduplicate_blocks_in_dependent_materialized_views'",
      "1",
    ],
  ]);
}

async function validateUsageSchema() {
  await expectScalars(admin, [
    [
      "usage ledger engine",
      "SELECT engine FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'",
      "SummingMergeTree",
    ],
    [
      "usage ledger bucket type",
      "SELECT type FROM system.columns WHERE database = 'app' AND table = 'tenant_usage' AND name = 'bucket'",
      "DateTime('UTC')",
    ],
    [
      "usage ledger partition key",
      "SELECT partition_key FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'",
      "toYYYYMM(bucket)",
    ],
    [
      "usage ledger sorting key",
      "SELECT sorting_key FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'",
      "tenant_id, bucket, meter",
    ],
    [
      "usage ledger has no TTL",
      "SELECT positionCaseInsensitive(create_table_query, ' TTL ') = 0 FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'",
      "1",
    ],
    [
      "metering materialized view count",
      "SELECT count() FROM system.tables WHERE database = 'app' AND name LIKE 'tenant_usage%_mv'",
      "7",
    ],
    [
      "materialized RowBytes column count",
      "SELECT count() FROM system.columns WHERE database = 'otel' AND name = 'RowBytes' AND default_kind = 'MATERIALIZED' AND startsWith(default_expression, 'byteSize(')",
      "7",
    ],
  ]);

  const policy = await scalar(
    admin,
    "SHOW CREATE ROW POLICY tenant_filter_tenant_usage ON app.tenant_usage",
  );
  expect(policy, "tenant usage row policy predicate").toContain(
    "USING tenant_id = getSetting('SQL_everr_tenant_id')",
  );
  expect(policy, "tenant usage row policy assignment").toContain("TO app_ro");
}

async function insertTelemetryFixture() {
  await executeSqlFile({
    user: "collector_rw",
    password: "collector-dev",
    file: TELEMETRY_FIXTURE_CONTAINER_PATH,
    settings: [
      "--async_insert=1",
      "--wait_for_async_insert=1",
      "--deduplicate_blocks_in_dependent_materialized_views=1",
      "--materialized_views_ignore_errors=0",
      "--asterisk_include_materialized_columns=0",
    ],
  });
}

beforeAll(async () => {
  const preFeatureInitFiles = await discoverPreFeatureInitFiles();
  const telemetryFixture = (
    await readFile(
      path.join(clickhouseDirectory, "fixtures", "usage-metering-signals.sql"),
      "utf8",
    )
  ).replaceAll(VALIDATION_RUN_ID_PLACEHOLDER, VALIDATION_RUN_ID);
  const filesToCopy = [
    ...preFeatureInitFiles.map((file) => ({
      source: path.join(initDirectory, file),
      target: `/docker-entrypoint-initdb.d/${file}`,
      mode: file.endsWith(".sh") ? 0o755 : 0o644,
    })),
    {
      source: path.join(initDirectory, USAGE_MIGRATION_FILE),
      target: USAGE_MIGRATION_CONTAINER_PATH,
      mode: 0o644,
    },
  ];

  container = await new ClickHouseContainer(CLICKHOUSE_IMAGE)
    .withUsername("default")
    .withPassword(ADMIN_PASSWORD)
    .withDatabase("default")
    .withEnvironment({
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
      COLLECTOR_RW_PASSWORD: "collector-dev",
      APP_RO_PASSWORD: "app-dev",
      WEB_APP_ADMIN_PASSWORD: "web-app-admin-dev",
    })
    .withCopyFilesToContainer(filesToCopy)
    .withCopyContentToContainer([
      {
        content: telemetryFixture,
        target: TELEMETRY_FIXTURE_CONTAINER_PATH,
        mode: 0o644,
      },
    ])
    .start();

  admin = createUserClient("default", ADMIN_PASSWORD);
  collector = createUserClient(
    "collector_rw",
    "collector-dev",
    collectorSettings,
  );
  appReader = createUserClient("app_ro", "app-dev");
  webAppAdmin = createUserClient("web_app_admin", "web-app-admin-dev");
});

afterAll(async () => {
  await Promise.allSettled(
    [admin, collector, appReader, webAppAdmin]
      .filter(Boolean)
      .map((client) => client.close()),
  );
  if (container) {
    await container.stop();
  }
});

describe.sequential("usage metering migration", () => {
  it("upgrades an existing cluster without billing historical rows", async () => {
    await expectScalar(
      admin,
      "pre-feature usage table absence",
      "SELECT count() FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'",
      "0",
    );

    await execute(
      admin,
      "ALTER TABLE otel.otel_logs ADD COLUMN RowBytes UInt64 MATERIALIZED toUInt64(1)",
    );
    await execute(
      collector,
      `
        INSERT INTO otel.otel_logs
          (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
        VALUES
          (now64(9, 'UTC'), now('UTC'), 'usage-test', 'before usage apply',
           map('everr.tenant.id', 'tenant-stale'))
      `,
    );
    await expectScalar(
      admin,
      "stale RowBytes fixture",
      "SELECT RowBytes FROM otel.otel_logs WHERE Body = 'before usage apply'",
      "1",
    );

    await validateCollectorSettings();
    await applyUsageMetering();
    await validateUsageSchema();

    expect(
      await scalar(admin, "SELECT version()"),
      "ClickHouse version",
    ).toMatch(/^26\.2\./);
    await expectScalar(
      admin,
      "stale expression converged",
      "SELECT startsWith(default_expression, 'byteSize(') FROM system.columns WHERE database = 'otel' AND table = 'otel_logs' AND name = 'RowBytes'",
      "1",
    );
    await expectScalar(
      admin,
      "historical materialized value is not rewritten",
      "SELECT RowBytes FROM otel.otel_logs WHERE Body = 'before usage apply'",
      "1",
    );
    await expectScalar(
      admin,
      "historical row is not backfilled",
      "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-stale'",
      "0",
    );
  });

  it("meters every telemetry signal and preserves existing fan-out", async () => {
    await insertTelemetryFixture();

    const rawTables = [
      "otel_traces",
      "otel_logs",
      "otel_metrics_gauge",
      "otel_metrics_sum",
      "otel_metrics_histogram",
      "otel_metrics_exponential_histogram",
      "otel_metrics_summary",
    ];
    await Promise.all(
      rawTables.map((table) =>
        expectScalar(
          admin,
          `${table} RowBytes contract`,
          `SELECT countIf(RowBytes != byteSize(*)) FROM otel.${table} WHERE ResourceAttributes['everr.usage.validation.run_id'] = '${VALIDATION_RUN_ID}' SETTINGS asterisk_include_materialized_columns = 0`,
          "0",
        ),
      ),
    );

    await expectScalar(
      admin,
      "log byteSize golden contract",
      "SELECT byteSize(*) FROM otel.otel_logs WHERE Body = 'metered log' SETTINGS asterisk_include_materialized_columns = 0",
      "322",
    );

    const traceBytes = await scalar(
      admin,
      "SELECT sum(RowBytes) FROM otel.otel_traces WHERE ResourceAttributes['everr.tenant.id'] = 'tenant-a'",
    );
    await expectScalar(
      admin,
      "trace bytes",
      "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'traces'",
      traceBytes,
    );
    await expectScalar(
      admin,
      "trace items",
      "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'traces'",
      "1",
    );

    const logBytes = await scalar(
      admin,
      "SELECT sum(RowBytes) FROM otel.otel_logs WHERE ResourceAttributes['everr.tenant.id'] = 'tenant-a'",
    );
    await expectScalar(
      admin,
      "log bytes",
      "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'logs'",
      logBytes,
    );
    await expectScalar(
      admin,
      "log items",
      "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'logs'",
      "1",
    );

    const rawMetricBytes = await scalar(
      admin,
      `
        SELECT sum(metric_bytes)
        FROM
        (
          SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_gauge
          UNION ALL
          SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_sum
          UNION ALL
          SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_histogram
          UNION ALL
          SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_exponential_histogram
          UNION ALL
          SELECT sum(RowBytes) AS metric_bytes FROM otel.otel_metrics_summary
        )
      `,
    );
    await expectScalar(
      admin,
      "metric bytes",
      "SELECT sum(bytes) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'metrics'",
      rawMetricBytes,
    );
    await expectScalar(
      admin,
      "metric items",
      "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-a' AND meter = 'metrics'",
      "5",
    );

    const fanOutTables = [
      "traces",
      "logs",
      "metrics_gauge",
      "metrics_sum",
      "metrics_histogram",
      "metrics_exponential_histogram",
      "metrics_summary",
    ];
    await Promise.all(
      fanOutTables.map((table) =>
        expectScalar(
          admin,
          `${table} fan-out`,
          `SELECT count() FROM app.${table} WHERE tenant_id = 'tenant-a'`,
          "1",
        ),
      ),
    );

    await expectScalar(
      admin,
      "arrival buckets are UTC hour starts",
      "SELECT countIf(bucket != toStartOfHour(bucket)) FROM app.tenant_usage",
      "0",
    );
  });

  it("enforces tenant isolation without exposing unattributed rows", async () => {
    await expectScalar(
      appReader,
      "tenant-a RLS",
      "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'",
      "7",
    );
    await expectScalar(
      appReader,
      "other-tenant RLS",
      "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'",
      "0",
    );

    await execute(
      collector,
      `
        INSERT INTO otel.otel_logs
          (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
        VALUES
          (now64(9, 'UTC'), now('UTC'), 'usage-test', 'unattributed log', map())
      `,
    );
    await expectScalar(
      webAppAdmin,
      "unattributed admin visibility",
      "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = ''",
      "1",
    );
    await expectScalar(
      appReader,
      "unattributed hidden by tenant-a RLS",
      "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'",
      "7",
    );

    await execute(
      collector,
      `
        INSERT INTO otel.otel_logs
          (Timestamp, TimestampTime, ServiceName, Body, ResourceAttributes)
        VALUES
          (now64(9, 'UTC'), now('UTC'), 'usage-test', 'other tenant log',
           map('everr.tenant.id', 'tenant-b'))
      `,
    );
    await expectScalar(
      appReader,
      "tenant-b RLS before reapply",
      "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'",
      "1",
    );
    await expectScalar(
      webAppAdmin,
      "cross-tenant admin visibility",
      "SELECT sum(items) FROM app.tenant_usage",
      "9",
    );
  });

  it("is repeatable on a populated cluster", async () => {
    await applyUsageMetering();
    await validateUsageSchema();

    await Promise.all([
      expectScalar(
        appReader,
        "tenant-a RLS after populated reapply",
        "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-a'",
        "7",
      ),
      expectScalar(
        appReader,
        "tenant-b RLS after populated reapply",
        "SELECT sum(items) FROM app.tenant_usage SETTINGS SQL_everr_tenant_id = 'tenant-b'",
        "1",
      ),
      expectScalar(
        webAppAdmin,
        "populated reapply does not duplicate usage",
        "SELECT sum(items) FROM app.tenant_usage",
        "9",
      ),
      expectScalar(
        admin,
        "populated reapply does not backfill historical row",
        "SELECT sum(items) FROM app.tenant_usage WHERE tenant_id = 'tenant-stale'",
        "0",
      ),
    ]);
  });
});
