import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "chdb";

const HISTORY_TABLE = "app.alert_events";

function clickhouseInitDir(): string {
  // testing/ -> alerting/ -> server/ -> src/ -> app/ -> packages/ -> repo root
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../clickhouse/init",
  );
}

/**
 * Statements out of one init file, with comments removed first.
 *
 * The files carry prose comments that contain semicolons, so splitting the
 * raw text on `;` cuts statements in half. Stripping line comments first is
 * what makes the split safe.
 */
function statementsIn(file: string): string[] {
  return readFileSync(join(clickhouseInitDir(), file), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * The retention dictionary, which `app.alert_events` names in its TTL.
 *
 * Its shipped definition reaches back into ClickHouse over the network as
 * `web_app_admin`. chdb is one process with no server and no users, so the
 * credentials are dropped and the dictionary reads the source table directly.
 * The columns, layout, lifetime and query all stay as shipped: this changes
 * how the dictionary authenticates, not what it holds.
 */
function withoutSourceCredentials(statement: string): string {
  return statement
    .replace(/^\s*user\s+'[^']*'\s*$/gm, "")
    .replace(/^\s*password\s+'[^']*'\s*$/gm, "");
}

/**
 * Whether a statement belongs to the access-control plane, which embedded
 * chdb has none of: it runs as `default`, cannot grant itself anything, and
 * refuses CREATE ROLE, CREATE ROW POLICY and the SQL_ custom settings.
 *
 * The grants and the tenant row policy at the end of the alert_events DDL are
 * therefore skipped rather than adapted. There is no honest stand-in for a
 * row policy here, and pretending otherwise would be worse than the gap: it
 * would make an unscoped read look scoped. This is the one part of the shipped
 * file this loader does not apply, and the reason no case in this suite may
 * claim anything about tenant isolation.
 */
function isAccessControl(statement: string): boolean {
  return /^\s*(GRANT|REVOKE|CREATE\s+ROLE|DROP\s+ROLE|CREATE\s+ROW\s+POLICY|DROP\s+ROW\s+POLICY|CREATE\s+USER|ALTER\s+USER|SET\s+ROLE)\b/i.test(
    statement,
  );
}

/**
 * The table without its TTL clause.
 *
 * TTL is the second thing a real engine evaluates against the machine clock
 * while this suite writes at a pinned virtual date, the same trap graphile's
 * `now()` sets in the job driver. Evaluation rows expire after 30 days, and
 * the cases write them at 2026-01-01, so on any machine more than a month
 * past that the engine drops them as they land and the case reads an empty
 * history. Keeping the clause would make the suite fail by calendar.
 *
 * Retention is out of scope for this suite for exactly that reason: proving
 * it needs a harness whose clock the engine shares. Everything the TTL does
 * not touch, which is every column, type, default and the deduplication
 * window, still comes from the shipped file.
 */
function withoutTtl(statement: string): string {
  return statement.replace(/\nTTL [\s\S]*?(?=\nSETTINGS )/, "\n");
}

function readJsonEachRow(out: unknown): Record<string, unknown>[] {
  const text = String(out ?? "").trim();
  if (text.length === 0) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

export interface SqlApiLikeResult {
  rows: Record<string, unknown>[];
  columns: string[];
  columnTypes: string[];
}

export interface ChdbDatabase {
  insert(rows: object[], deduplicationToken?: string): void;
  historyRows(): Record<string, unknown>[];
  /** Arbitrary SQL, for cases whose subject is what the engine itself says. */
  queryRows(statement: string): Record<string, unknown>[];
  /** A rule's own SQL, run for real, with the engine's column metadata. */
  runQuery(statement: string): SqlApiLikeResult;
  /** Replace what `app.test_signal` holds, which is what a rule selects. */
  setSignal(rows: Record<string, unknown>[]): void;
  truncate(): void;
  close(): void;
}

/**
 * A real ClickHouse for the alerting history, embedded in the test process.
 *
 * What this buys over a hand-written double: the column types, the DEFAULT
 * expressions, the TTL and the insert deduplication are the ones the shipped
 * DDL declares, so a row the pipeline writes has to survive the same engine
 * production writes it to. A double accepts whatever shape it is handed.
 *
 * What it deliberately does NOT cover: embedded chdb runs as `default` with
 * no access management and cannot grant itself any, so `CREATE ROLE`,
 * `CREATE ROW POLICY` and the `SQL_everr_*` custom settings all fail. Tenant
 * isolation in production is a row policy. Reads here run unrestricted, so
 * nothing in this suite is evidence that a query is correctly scoped to a
 * tenant. Do not let a case claim that.
 */
/**
 * chdb holds one data directory per process: opening a second while the first
 * is live throws. The handle therefore lives on `globalThis`, not in a module
 * variable, because vitest can load this module more than once in a worker
 * (the mocked `@/lib/clickhouse` graph and a direct import resolve through
 * different registries) and two module copies would each boot an engine.
 * vitest isolates test files, so one process is one file in practice.
 */
const ACTIVE_KEY = Symbol.for("everr.alerting.testing.chdb");

type ChdbHost = { [ACTIVE_KEY]?: ChdbDatabase };

export function createChdbDatabase(): ChdbDatabase {
  const host = globalThis as unknown as ChdbHost;
  const existing = host[ACTIVE_KEY];
  if (existing) return existing;
  const dataDir = mkdtempSync(join(tmpdir(), "everr-chdb-"));
  const session = new Session(dataDir);

  const run = (statement: string) => {
    session.query(statement, "CSV");
  };

  run("CREATE DATABASE IF NOT EXISTS app");
  for (const statement of statementsIn("10-create-mvs.sql")) {
    // Only the retention pair, not the telemetry tables and materialized
    // views in the rest of that file: alert_events needs the dictionary its
    // TTL calls, and nothing else in there.
    if (
      statement.includes("tenant_retention_source") ||
      statement.includes("DICTIONARY IF NOT EXISTS app.tenant_retention")
    ) {
      run(withoutSourceCredentials(statement));
    }
  }
  for (const statement of statementsIn("12-create-alert-events.sql")) {
    if (isAccessControl(statement)) continue;
    run(withoutTtl(statement));
  }

  // The table a rule's query reads. Cases used to declare the query's result
  // directly; now they put rows here and the rule's own SQL selects them, so
  // the engine decides the column types, and a cleared signal is an empty
  // result set rather than a hand-made empty array.
  let signalColumns: string[] = [];
  const createSignalTable = (columns: [string, string][]) => {
    run("DROP TABLE IF EXISTS app.test_signal");
    run(
      `CREATE TABLE app.test_signal (${columns
        .map(([name, type]) => `${name} ${type}`)
        .join(", ")}) ENGINE = MergeTree ORDER BY tuple()`,
    );
    signalColumns = columns.map(([name]) => name);
  };
  createSignalTable([
    ["service", "String"],
    ["value", "Float64"],
  ]);

  const database: ChdbDatabase = {
    runQuery(statement) {
      // FORMAT JSON, not JSONEachRow, for the reason production gives in
      // lib/clickhouse.ts: the metadata block is there even when the result
      // is empty, so a rule that matches nothing still has columns.
      const parsed = JSON.parse(
        String(session.query(`${statement} FORMAT JSON`, "JSON") ?? "{}"),
      ) as {
        meta?: { name: string; type: string }[];
        data?: Record<string, unknown>[];
      };
      return {
        rows: parsed.data ?? [],
        columns: (parsed.meta ?? []).map((column) => column.name),
        columnTypes: (parsed.meta ?? []).map((column) => column.type),
      };
    },
    setSignal(rows) {
      if (rows.length === 0) {
        // Keep the shape: a case clearing the signal is saying "the same
        // query now matches nothing", not "the columns changed".
        run("TRUNCATE TABLE app.test_signal");
        return;
      }
      // The shape follows the rows the case wrote, so a case needing an extra
      // label column just sends one, the way it used to just declare one.
      createSignalTable(
        Object.entries(rows[0]).map(([name, value]) => [
          name,
          typeof value === "number"
            ? "Float64"
            : typeof value === "boolean"
              ? "Bool"
              : "String",
        ]),
      );
      run(
        `INSERT INTO app.test_signal (${signalColumns.join(", ")}) FORMAT JSONEachRow\n${rows
          .map((row) => JSON.stringify(row))
          .join("\n")}`,
      );
    },
    insert(rows, deduplicationToken) {
      if (rows.length === 0) return;
      // JSONEachRow payload, not a SQL literal: the JSON goes in raw. Quoting
      // it the way a string literal is quoted would corrupt every row that
      // contains a quote or a backslash.
      const values = rows.map((row) => JSON.stringify(row)).join("\n");
      const settings =
        deduplicationToken === undefined
          ? ""
          : ` SETTINGS insert_deduplication_token = '${deduplicationToken.replace(/'/g, "\\'")}'`;
      run(
        `INSERT INTO ${HISTORY_TABLE}${settings} FORMAT JSONEachRow\n${values}`,
      );
    },
    queryRows(statement) {
      return readJsonEachRow(
        session.query(`${statement} FORMAT JSONEachRow`, "JSONEachRow"),
      );
    },
    historyRows() {
      // Insert order is not a property of a MergeTree, so order by the write
      // clock and fall back to the row's own id: what the double handed back
      // in push order, this reproduces deterministically.
      const out = session.query(
        `SELECT * FROM ${HISTORY_TABLE} ORDER BY event_time, event_id FORMAT JSONEachRow`,
        "JSONEachRow",
      );
      return readJsonEachRow(out);
    },
    truncate() {
      run(`TRUNCATE TABLE ${HISTORY_TABLE}`);
    },
    close() {
      session.cleanup();
      rmSync(dataDir, { recursive: true, force: true });
      host[ACTIVE_KEY] = undefined;
    },
  };
  host[ACTIVE_KEY] = database;
  return database;
}
