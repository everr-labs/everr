import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "chdb";

import { resolveRetention } from "@/lib/retention";

const HISTORY_TABLE = "app.alert_events";

function clickhouseInitDir(): string {
  // testing/ -> alerting/ -> server/ -> src/ -> app/ -> packages/ -> repo root
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../clickhouse/init",
  );
}

// Strip line comments before splitting statements: comments can contain semicolons.
function statementsIn(file: string): string[] {
  return readFileSync(join(clickhouseInitDir(), file), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

// Embedded chDB has no access management. Skip grants and policies;
// these tests do not verify tenant isolation.
function isAccessControl(statement: string): boolean {
  return /^\s*(GRANT|REVOKE|CREATE\s+ROLE|DROP\s+ROLE|CREATE\s+ROW\s+POLICY|DROP\s+ROW\s+POLICY|CREATE\s+USER|ALTER\s+USER|SET\s+ROLE)\b/i.test(
    statement,
  );
}

// Fixtures use fixed timestamps, so omit TTL to keep them independent of the
// machine clock. Expiry is outside this suite; the remaining DDL stays intact.
function withoutTtl(statement: string): string {
  return statement.replace(/\nTTL [\s\S]*?(?=\nSETTINGS )/, "\n");
}

/** One value as the text ClickHouse parses against the placeholder's type. */
function paramText(name: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) {
    return `[${value.map((item) => quoteArrayItem(name, item)).join(",")}]`;
  }
  throw new Error(
    `query parameter ${name} is a ${typeof value}, which has no ClickHouse text form. Convert it at the call site, the way production converts a Date with toClickHouseDateTime.`,
  );
}

function quoteArrayItem(name: string, item: unknown): string {
  if (typeof item === "number" || typeof item === "bigint") return String(item);
  if (typeof item !== "string") {
    throw new Error(`query parameter ${name} holds a non-scalar array item`);
  }
  return quoteSqlString(item);
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const PLACEHOLDER = /\{(\w+):/g;

interface SqlApiLikeResult {
  rows: Record<string, unknown>[];
  columns: string[];
  columnTypes: string[];
}

function readJsonEachRow(out: unknown): Record<string, unknown>[] {
  const text = String(out ?? "").trim();
  if (text.length === 0) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

export type QueryParams = Record<string, unknown>;

export interface ChdbDatabase {
  insert(rows: object[], deduplicationToken?: string): void;
  historyRows(): Record<string, unknown>[];
  /** Arbitrary SQL, for cases whose subject is what the engine itself says. */
  queryRows(statement: string, params?: QueryParams): Record<string, unknown>[];
  /** A rule's own SQL, run for real, with the engine's column metadata. */
  runQuery(statement: string, params?: QueryParams): SqlApiLikeResult;
  /** Replace what `app.test_signal` holds, which is what a rule selects. */
  setSignal(rows: Record<string, unknown>[]): void;
  truncate(): void;
  close(): void;
}

// Vitest can load this module through multiple registries. Share one handle
// on globalThis because chDB permits only one active data directory per process.
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

  /**
   * Bind `{name:Type}` placeholders the way production's `query_params` does.
   *
   * ClickHouse takes parameters as session settings (`SET param_<name>`), and
   * a session keeps them until it ends. That is the trap: a statement that
   * forgets a parameter would silently answer with whatever an earlier
   * statement left under that name, and every alerting query names its
   * parameter `organizationId`. So every placeholder in the statement is
   * checked against what the caller supplied, before anything is set. An
   * unbound one is the error ClickHouse itself raises for it.
   */
  const bindParams = (statement: string, params: QueryParams = {}) => {
    for (const [, name] of statement.matchAll(PLACEHOLDER)) {
      if (!(name in params)) {
        throw new Error(`Substitution \`${name}\` is not set`);
      }
    }
    for (const [name, value] of Object.entries(params)) {
      run(`SET param_${name} = ${quoteSqlString(paramText(name, value))}`);
    }
  };

  run("CREATE DATABASE IF NOT EXISTS app");
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
    runQuery(statement, params) {
      bindParams(statement, params);
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
      // Direct fixture inserts need the retention stamp normally supplied by the writer.
      const retention = resolveRetention("free");
      const stamped = rows.map((row) => {
        const eventType = "event_type" in row ? row.event_type : undefined;
        const isEvaluation =
          eventType === "evaluation_succeeded" ||
          eventType === "evaluation_failed";
        return {
          retention_days: isEvaluation
            ? retention.alertEvaluationDays
            : retention.alertLifecycleDays,
          ...row,
        };
      });
      // JSONEachRow payload, not a SQL literal: the JSON goes in raw. Quoting
      // it the way a string literal is quoted would corrupt every row that
      // contains a quote or a backslash.
      const values = stamped.map((row) => JSON.stringify(row)).join("\n");
      const settings =
        deduplicationToken === undefined
          ? ""
          : ` SETTINGS insert_deduplication_token = '${deduplicationToken.replace(/'/g, "\\'")}'`;
      run(
        `INSERT INTO ${HISTORY_TABLE}${settings} FORMAT JSONEachRow\n${values}`,
      );
    },
    queryRows(statement, params) {
      bindParams(statement, params);
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
