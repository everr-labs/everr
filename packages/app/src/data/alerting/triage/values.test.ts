import { describe, expect, it, vi } from "vitest";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { loadInstanceValues, parseSamples, type ValueRule } from "./values";

const MINUTE = 60_000;
const NOW = new Date("2026-08-21T12:00:00Z");
const WINDOW = { from: new Date(NOW.getTime() - 60 * MINUTE), to: NOW };

type ValueRow = {
  slug: string;
  fingerprint: string;
  sample_labels: string;
  bucket: string;
  last: number;
  low: number;
  high: number;
};

/** ClickHouse's own DateTime spelling for `minutes` before the window end. */
function bucketAt(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", "");
}

function row(overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    slug: "demo/latency",
    fingerprint: "a",
    sample_labels: '{"host":"a"}',
    bucket: bucketAt(10),
    last: 50,
    low: 50,
    high: 50,
    ...overrides,
  };
}

/** The ClickHouse seam: the query is injected, so a test hands the loader
 *  the rows the table would have returned and reads the lanes it builds. */
function queryReturning(rows: ValueRow[]) {
  const query = vi.fn((_sql: string, _params?: Record<string, unknown>) =>
    Promise.resolve(rows),
  );
  return { query: query as unknown as ClickhouseQuery, calls: query.mock };
}

const LATENCY: ValueRule = {
  path: "demo/latency",
  condition: { operator: "gt", threshold: 100 },
  intervalSecs: 60,
};

describe("loadInstanceValues", () => {
  it("asks nothing of ClickHouse for no rules, and still sizes the bucket", async () => {
    const { query, calls } = queryReturning([]);
    const out = await loadInstanceValues(query, { rules: [], ...WINDOW });
    expect(calls.calls).toHaveLength(0);
    expect(out).toEqual({ byPath: new Map(), bucketMs: MINUTE });
  });

  it("buckets no finer than the smallest evaluation interval, and no finer than the window allows", async () => {
    const { query, calls } = queryReturning([]);
    await loadInstanceValues(query, {
      rules: [LATENCY, { ...LATENCY, path: "demo/slow", intervalSecs: 300 }],
      ...WINDOW,
    });
    expect(calls.calls[0][1]).toMatchObject({
      slugs: ["demo/latency", "demo/slow"],
      bucket: 60,
    });

    const { query: wide, calls: wideCalls } = queryReturning([]);
    const out = await loadInstanceValues(wide, {
      rules: [LATENCY],
      from: new Date(NOW.getTime() - 7 * 24 * 60 * MINUTE),
      to: NOW,
    });
    // A week at one minute is ten thousand readings; sixty buckets across it
    // is 168 minutes each.
    expect(wideCalls.calls[0][1]).toMatchObject({ bucket: 168 * 60 });
    expect(out.bucketMs).toBe(168 * MINUTE);
  });

  it("turns buckets into lanes measured from the window end, breaching when either extreme crosses", async () => {
    const { query } = queryReturning([
      row({ bucket: bucketAt(20), last: 90, low: 80, high: 90 }),
      // The bucket's last reading is under the threshold; its peak was not.
      row({ bucket: bucketAt(10), last: 95, low: 95, high: 130 }),
    ]);
    const out = await loadInstanceValues(query, {
      rules: [LATENCY],
      ...WINDOW,
    });
    expect(out.byPath.get("demo/latency")).toEqual({
      hidden: 0,
      lanes: [
        {
          fingerprint: "a",
          labels: "host=a",
          points: [
            { at: 20, value: 90, low: 80, high: 90, breaching: false },
            { at: 10, value: 95, low: 95, high: 130, breaching: true },
          ],
        },
      ],
    });
  });

  it("puts breaching lanes first, then the higher peak, and caps at ten", async () => {
    const rows: ValueRow[] = [];
    for (let i = 0; i < 12; i++) {
      const fingerprint = `quiet-${String(i).padStart(2, "0")}`;
      rows.push(
        row({
          fingerprint,
          sample_labels: `{"host":"${fingerprint}"}`,
          last: 10 + i,
          low: 10 + i,
          high: 10 + i,
        }),
      );
    }
    rows.push(
      row({
        fingerprint: "hot",
        sample_labels: '{"host":"hot"}',
        last: 101,
        low: 101,
        high: 101,
      }),
    );
    const { query } = queryReturning(rows);
    const out = await loadInstanceValues(query, {
      rules: [LATENCY],
      ...WINDOW,
    });
    const lanes = out.byPath.get("demo/latency");
    expect(lanes?.hidden).toBe(3);
    expect(lanes?.lanes.map((lane) => lane.fingerprint)).toEqual([
      "hot",
      "quiet-11",
      "quiet-10",
      "quiet-09",
      "quiet-08",
      "quiet-07",
      "quiet-06",
      "quiet-05",
      "quiet-04",
      "quiet-03",
    ]);
  });

  it("names lanes from the caller's labels first, then the rows', and survives a label set that will not parse", async () => {
    const { query } = queryReturning([
      row({ fingerprint: "named-by-caller", sample_labels: '{"host":"row"}' }),
      row({ fingerprint: "named-by-row", sample_labels: '{"host":"row"}' }),
      row({ fingerprint: "unlabelled", sample_labels: "not json" }),
    ]);
    const out = await loadInstanceValues(query, {
      rules: [LATENCY],
      ...WINDOW,
      labels: new Map([["named-by-caller", "host=caller"]]),
    });
    expect(
      out.byPath
        .get("demo/latency")
        ?.lanes.map((lane) => [lane.fingerprint, lane.labels])
        .sort(),
    ).toEqual([
      ["named-by-caller", "host=caller"],
      ["named-by-row", "host=row"],
      ["unlabelled", "no labels"],
    ]);
  });

  it("keeps rules apart by path and leaves out a rule that evaluated nothing", async () => {
    const { query } = queryReturning([
      row({ slug: "demo/latency" }),
      row({ slug: "demo/errors", fingerprint: "b", sample_labels: "{}" }),
    ]);
    const out = await loadInstanceValues(query, {
      rules: [
        LATENCY,
        { ...LATENCY, path: "demo/errors" },
        { ...LATENCY, path: "demo/quiet" },
      ],
      ...WINDOW,
    });
    expect([...out.byPath.keys()]).toEqual(["demo/latency", "demo/errors"]);
    expect(out.byPath.get("demo/errors")?.lanes[0].labels).toBe("no labels");
  });
});

describe("parseSamples", () => {
  it("reads the sample array back and shrugs at rows written in an older shape", () => {
    expect(parseSamples('[{"fingerprint":"a","labels":{},"value":1}]')).toEqual(
      [{ fingerprint: "a", labels: {}, value: 1 }],
    );
    expect(parseSamples("")).toEqual([]);
    expect(parseSamples("{")).toEqual([]);
    expect(parseSamples('{"not":"an array"}')).toEqual([]);
  });
});
