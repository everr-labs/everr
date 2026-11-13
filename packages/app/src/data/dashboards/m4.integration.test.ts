// @vitest-environment node
import { bucketSeconds } from "@everr/ui/lib/bucket";
import { Session } from "chdb";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  buildM4Query,
  type ColumnRoles,
  m4BucketSeconds,
  resolveColumnRoles,
  stripStatementTerminator,
} from "./m4";

const session = new Session();
afterAll(() => session.cleanup());

type Row = Record<string, unknown>;

function run(sql: string): Row[] {
  const text = String(session.query(sql, "JSONEachRow") ?? "").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

function describeRoles(sql: string): ColumnRoles {
  const columns = run(`DESCRIBE (\n${stripStatementTerminator(sql)}\n)`).map((r) => ({
    name: String(r.name),
    type: String(r.type),
  }));
  const roles = resolveColumnRoles(columns);
  if (!roles) throw new Error("columns cannot be wrapped");
  return roles;
}

const BASE = "toDateTime('2026-01-01 00:00:00', 'UTC')";
const BASE_EPOCH = Date.UTC(2026, 0, 1) / 1000;
const key = (row: Row) => JSON.stringify(row);

describe("M4 wrapper on ClickHouse", () => {
  it("returns a {step}-bucketed query unchanged, in the author's order", () => {
    const from = new Date(BASE_EPOCH * 1000);
    const to = new Date((BASE_EPOCH + 3600) * 1000);
    const step = bucketSeconds(from, to, 500);
    const sql = `
SELECT toStartOfInterval(t, INTERVAL ${step} SECOND) AS ts, s AS service, avg(v) AS p95
FROM (
  SELECT ${BASE} + number AS t, ['b', 'a', 'c'][number % 3 + 1] AS s, sin(number / 100) * 10 + number % 7 AS v
  FROM numbers(3600)
)
GROUP BY ts, service
ORDER BY ts, indexOf(['c', 'a', 'b'], service);`;

    const expected = run(stripStatementTerminator(sql));
    expect(expected.length).toBeGreaterThan(1000);

    const wrapped = run(buildM4Query(sql, describeRoles(sql), m4BucketSeconds(from, to)));
    expect(wrapped).toEqual(expected);
  });

  describe("on a large raw series with a short spike", () => {
    const RANGE_SECONDS = 30_000;
    const from = new Date(BASE_EPOCH * 1000);
    const to = new Date((BASE_EPOCH + RANGE_SECONDS) * 1000);
    const SPIKE_VALUE = 1000;
    // Rows 20000, 20002 and 20004 belong to series "a", at consecutive seconds.
    const sql = `
SELECT ${BASE} + intDiv(number, 2) AS ts,
       if(number % 2 = 0, 'a', 'b') AS service,
       if(number IN (20000, 20002, 20004), ${SPIKE_VALUE}, (number * 7919) % 97) AS value
FROM numbers(${RANGE_SECONDS * 2})
ORDER BY ts, service`;
    const seconds = m4BucketSeconds(from, to);
    const buckets = Math.ceil(RANGE_SECONDS / seconds);

    it("keeps the spike, the first and last row, and only rows that exist in the input", () => {
      const input = run(sql);
      expect(input.length).toBeGreaterThanOrEqual(50_000);
      const inputKeys = new Set(input.map(key));

      const wrapped = run(buildM4Query(sql, describeRoles(sql), seconds));

      expect(wrapped.every((row) => inputKeys.has(key(row)))).toBe(true);
      for (const service of ["a", "b"]) {
        const own = wrapped.filter((row) => row.service === service);
        expect(own.length).toBeLessThanOrEqual(4 * (buckets + 1));
        const inputOwn = input.filter((row) => row.service === service);
        expect(own[0]).toEqual(inputOwn[0]);
        expect(own.at(-1)).toEqual(inputOwn.at(-1));
      }
      const spiked = wrapped.filter((row) => row.value === SPIKE_VALUE);
      expect(spiked.map((row) => row.ts)).toContain(
        input.find((row) => row.value === SPIKE_VALUE)?.ts,
      );
      expect(wrapped.length).toBeLessThan(input.length / 20);
    });

    it("keeps the author's row order", () => {
      const wrapped = run(buildM4Query(sql, describeRoles(sql), seconds));
      const order = wrapped.map((row) => `${String(row.ts)}|${String(row.service)}`);
      expect(order).toEqual([...order].sort());
    });

    it("succeeds under a result cap that the unwrapped query exceeds", () => {
      const cap = "SETTINGS max_result_rows = 5000, result_overflow_mode = 'throw'";
      expect(() => run(`${sql}\n${cap}`)).toThrow();
      const wrapped = run(`${buildM4Query(sql, describeRoles(sql), seconds)}\n${cap}`);
      expect(wrapped.length).toBeGreaterThan(0);
      expect(wrapped.length).toBeLessThanOrEqual(5000);
    });
  });

  it("keeps each value column's lowest and highest row, and invents no row for NULL buckets", () => {
    const WIDTH = 10;
    const sql = `
SELECT ${BASE} + number AS ts,
       number * 1.37 % 101 + number / 1000 AS a,
       if(number < 50, NULL, (number * 53) % 89 + number / 1000) AS c
FROM numbers(100)
ORDER BY ts`;
    const input = run(sql);
    const roles = describeRoles(sql);
    expect(roles.values).toEqual(["a", "c"]);

    const expected = new Set<Row>();
    const epoch = (row: Row) => Date.parse(`${String(row.ts).replace(" ", "T")}Z`) / 1000;
    for (let start = 0; start < 100; start += WIDTH) {
      const bucket = input.filter(
        (row) => Math.floor(epoch(row) / WIDTH) === Math.floor((BASE_EPOCH + start) / WIDTH),
      );
      const pick = (field: string, better: (x: number, y: number) => boolean) => {
        const present = bucket.filter((row) => row[field] !== null);
        if (present.length === 0) return;
        expected.add(
          present.reduce((best, row) =>
            better(Number(row[field]), Number(best[field])) ? row : best,
          ),
        );
      };
      pick("ts", (x, y) => x < y);
      pick("ts", (x, y) => x > y);
      pick("a", (x, y) => x < y);
      pick("a", (x, y) => x > y);
      pick("c", (x, y) => x < y);
      pick("c", (x, y) => x > y);
    }

    const wrapped = run(buildM4Query(sql, roles, WIDTH));
    expect(new Set(wrapped.map(key))).toEqual(new Set([...expected].map(key)));
    expect(wrapped.map(key)).toEqual(
      input.map(key).filter((k) => new Set([...expected].map(key)).has(k)),
    );
  });
});
