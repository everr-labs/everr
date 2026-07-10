import { randomUUID } from "node:crypto";
import {
  ERROR_TRIAGE_EVENTS_TABLE,
  ErrorsRepository,
} from "@everr/telemetry-explorer/errors";
import { describe, expect, it } from "vitest";
import { createClient } from "@/lib/clickhouse-client";

// Env-gated real-ClickHouse integration test (the ClickHouse counterpart of
// the TEST_DATABASE_URL pattern in server/alerts/01-scanner.integration.test.ts).
// Point TEST_CLICKHOUSE_URL at a ClickHouse provisioned by clickhouse/init
// with credentials allowed to INSERT into app.logs and app.error_triage_events
// (locally: http://default:everr@localhost:8123). Reads run through the same
// ErrorsRepository the web UI uses; tenant row policies are app_ro concerns
// proven elsewhere, so isolation here comes from run-unique names instead.
const clickhouseUrl = process.env.TEST_CLICKHOUSE_URL;

// Inserts run outside the app database session, so qualify like the write
// module does (see server/errors/triage-events.ts).
const QUALIFIED_EVENTS_TABLE = `app.${ERROR_TRIAGE_EVENTS_TABLE}`;

describe.skipIf(!clickhouseUrl)("regression rule on real ClickHouse", () => {
  it("reopens resolved Errors only on genuine Regressions", async () => {
    const run = randomUUID().slice(0, 8);
    const tenant = `it-tenant-${run}`;
    const service = `it-svc-${run}`;
    const fp = (name: string) => `it-fp-${name}-${run}`;

    const now = Date.now();
    const at = (minutesAgo: number) =>
      new Date(now - minutesAgo * 60_000).toISOString();
    // Timeline: first Occurrences (and v1's first-seen) at t0, the status
    // events at t1, post-status Occurrences (and v2's first-seen) at t2.
    const t0 = at(50);
    const t1 = at(30);
    const t2 = at(10);

    const clickhouse = createClient({ url: clickhouseUrl, database: "app" });

    const occurrence = (
      name: string,
      timestamp: string,
      version: string | null,
    ) => ({
      Timestamp: timestamp,
      // Plain column in app.logs (the CTAS carries no DEFAULT), so it must be
      // stamped explicitly like the ingest MV does.
      TimestampTime: timestamp,
      SeverityText: "ERROR",
      SeverityNumber: 17,
      ServiceName: service,
      Body: `boom ${name}`,
      ResourceAttributes: {
        "service.name": service,
        "everr.tenant.id": tenant,
        ...(version === null ? {} : { "service.version": version }),
      },
      LogAttributes: {
        "exception.type": `ItError${name.toUpperCase()}`,
        "exception.message": `boom ${name}`,
        "error.fingerprint": fp(name),
      },
      tenant_id: tenant,
    });

    const statusEvent = (
      name: string,
      type: "resolved" | "ignored",
      timestamp: string,
    ) => ({
      tenant_id: tenant,
      fingerprint: fp(name),
      event_id: randomUUID(),
      version: 0,
      event_type: type,
      body: type === "resolved" ? "Fixed upstream." : "",
      author_id: `it-user-${run}`,
      deleted: 0,
      event_time: timestamp,
      updated_at: timestamp,
    });

    try {
      const seedLogs = clickhouse.insert({
        table: "app.logs",
        format: "JSONEachRow",
        clickhouse_settings: { date_time_input_format: "best_effort" },
        values: [
          // a: resolved, then an Occurrence from v2 (first seen after the
          // Resolution) — a genuine Regression.
          occurrence("a", t0, "v1"),
          occurrence("a", t2, "v2"),
          // b: resolved, then a same-version straggler from v1 (first seen
          // before the Resolution) — stays resolved.
          occurrence("b", t0, "v1"),
          occurrence("b", t2, "v1"),
          // c: resolved, then a versionless Occurrence newer than the
          // Resolution — timestamp fallback reopens.
          occurrence("c", t0, null),
          occurrence("c", t2, null),
          // d: ignored, then an Occurrence that would regress a — ignored
          // is sticky.
          occurrence("d", t0, "v1"),
          occurrence("d", t2, "v2"),
          // e: resolved with no Occurrence after the Resolution — stays
          // resolved.
          occurrence("e", t0, null),
        ],
      });
      const seedEvents = clickhouse.insert({
        table: QUALIFIED_EVENTS_TABLE,
        format: "JSONEachRow",
        clickhouse_settings: { date_time_input_format: "best_effort" },
        values: [
          statusEvent("a", "resolved", t1),
          statusEvent("b", "resolved", t1),
          statusEvent("c", "resolved", t1),
          statusEvent("d", "ignored", t1),
          statusEvent("e", "resolved", t1),
        ],
      });
      await Promise.all([seedLogs, seedEvents]);

      const repo = new ErrorsRepository(
        {
          execute: async <T>(sql: string, params?: Record<string, unknown>) => {
            const result = await clickhouse.query({
              query: sql,
              query_params: params,
              format: "JSONEachRow",
            });
            return result.json<T>();
          },
        },
        { triageEvents: true },
      );
      const searchInput = {
        fromTs: at(120),
        toTs: at(0),
        q: "",
        service: [service],
        fingerprint: "",
        sort: "lastSeen" as const,
        status: [],
        limit: 50,
        offset: 0,
        attributes: [],
      };

      const { issues } = await repo.searchIssues(searchInput);
      const byName = (name: string) =>
        issues.find((issue) => issue.fingerprint === fp(name));

      expect(byName("a")).toMatchObject({ status: "open", regressed: true });
      expect(byName("b")).toMatchObject({
        status: "resolved",
        regressed: false,
      });
      expect(byName("c")).toMatchObject({ status: "open", regressed: true });
      expect(byName("d")).toMatchObject({
        status: "ignored",
        regressed: false,
      });
      expect(byName("e")).toMatchObject({
        status: "resolved",
        regressed: false,
      });

      // The derived status drives the filter: open must return exactly the
      // two rule-reopened Errors.
      const openOnly = await repo.searchIssues({
        ...searchInput,
        status: ["open"],
      });
      expect(openOnly.issues.map((issue) => issue.fingerprint).sort()).toEqual(
        [fp("a"), fp("c")].sort(),
      );

      // The detail load (fingerprint-pruned triage scan) derives the same
      // Regression the list shows.
      const detail = await repo.getIssue({
        fingerprint: fp("a"),
        fromTs: searchInput.fromTs,
        toTs: searchInput.toTs,
        service: [service],
        occurrenceLimit: 10,
      });
      expect(detail.summary).toMatchObject({ status: "open", regressed: true });
    } finally {
      // Covers the seeded rows and the metadata markers the triage MV
      // projected into app.logs, which all carry the run-unique tenant.
      await Promise.all(
        ["app.logs", QUALIFIED_EVENTS_TABLE].map((table) =>
          clickhouse
            .command({
              query: `DELETE FROM ${table} WHERE tenant_id = '${tenant}'`,
            })
            .catch(() => {}),
        ),
      );
      await clickhouse.close();
    }
  }, 60_000);
});
