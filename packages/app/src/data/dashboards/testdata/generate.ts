import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import type { QueryResultRow } from "@/components/dashboards/visualizations";
import type { RandomWalkSpec, TableSpec, TestDataSpec } from "./spec";

export interface TestDataParams {
  /** ClickHouse DateTime string (start of range). */
  from: string;
  /** ClickHouse DateTime string (end of range). */
  to: string;
  /** Adaptive bucket width in seconds. */
  step: number;
}

/** Deterministic PRNG (mulberry32) → floats in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

function applyRound(value: number, round?: number): number {
  if (round === undefined) return value;
  const rounded = Number(value.toFixed(round));
  // Normalize negative zero to positive zero.
  return rounded === 0 ? 0 : rounded;
}

function parseMs(s: string): number {
  const d = parseTimestampAsUTC(s);
  return d ? d.getTime() : 0;
}

/** Bucket timestamps (ms) across [from,to] inclusive at `step` seconds. */
function bucketMs(params: TestDataParams): number[] {
  const fromMs = parseMs(params.from);
  const toMs = parseMs(params.to);
  const stepMs = Math.max(1, params.step) * 1000;
  const out: number[] = [];
  for (let ts = fromMs; ts <= toMs; ts += stepMs) out.push(ts);
  return out;
}

interface WalkParams {
  start: number;
  noise: number;
  min?: number;
  max?: number;
  round?: number;
  nullChance?: number;
}

/** One random-walk stream → an array of `count` values (or nulls). */
function walk(p: WalkParams, seed: number, count: number): (number | null)[] {
  const rng = mulberry32(seed);
  let value = p.start;
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    value = clamp(value + (rng() * 2 - 1) * p.noise, p.min, p.max);
    const isNull = (p.nullChance ?? 0) > 0 && rng() < (p.nullChance ?? 0);
    out.push(isNull ? null : applyRound(value, p.round));
  }
  return out;
}

function generateRandomWalk(
  spec: RandomWalkSpec,
  params: TestDataParams,
): QueryResultRow[] {
  const timestamps = spec.timeColumn ? bucketMs(params) : undefined;
  const count = timestamps ? timestamps.length : spec.points;

  // One walk per series; each seeded off (seed + index) so series differ.
  const seriesValues = spec.series.map((s, i) =>
    walk(
      {
        start: s.start,
        noise: s.noise,
        min: s.min,
        max: s.max,
        round: s.round,
        nullChance: s.nullChance,
      },
      spec.seed + i,
      count,
    ),
  );

  const tsStr = (i: number): string =>
    toClickHouseDateTime(new Date((timestamps as number[])[i] as number));

  // Long output: one row per (bucket, series), label + value columns.
  if (spec.labelColumn) {
    const rows: QueryResultRow[] = [];
    for (let i = 0; i < count; i++) {
      for (let s = 0; s < spec.series.length; s++) {
        const row: QueryResultRow = {};
        if (timestamps) row.ts = tsStr(i);
        row[spec.labelColumn] = (spec.series[s] as { name: string }).name;
        row[spec.valueColumn] = (seriesValues[s] as (number | null)[])[i] as
          | number
          | null;
        rows.push(row);
      }
    }
    return rows;
  }

  // Wide output: ts + one column per series.
  const rows: QueryResultRow[] = [];
  for (let i = 0; i < count; i++) {
    const row: QueryResultRow = {};
    if (timestamps) row.ts = tsStr(i);
    spec.series.forEach((s, si) => {
      row[s.name] = (seriesValues[si] as (number | null)[])[i] as number | null;
    });
    rows.push(row);
  }
  return rows;
}

function generateTable(
  spec: TableSpec,
  params: TestDataParams,
): QueryResultRow[] {
  if (spec.rows === 0) return [];
  const fromMs = parseMs(params.from);
  const toMs = parseMs(params.to);

  // Pre-roll each walk column's stream so values are stable per row index.
  const walkStreams = spec.columns.map((c, i) =>
    c.walk ? walk({ ...c.walk }, spec.seed + i, spec.rows) : undefined,
  );

  const rows: QueryResultRow[] = [];
  for (let r = 0; r < spec.rows; r++) {
    const row: QueryResultRow = {};
    spec.columns.forEach((c, ci) => {
      if (c.time) {
        const ms =
          spec.rows <= 1
            ? fromMs
            : fromMs + Math.round(((toMs - fromMs) * r) / (spec.rows - 1));
        row[c.name] = toClickHouseDateTime(new Date(ms));
      } else if (c.seq) {
        row[c.name] = r + 1;
      } else if (c.values && c.values.length > 0) {
        row[c.name] = c.values[r % c.values.length] ?? null;
      } else if (walkStreams[ci]) {
        row[c.name] = (walkStreams[ci] as (number | null)[])[r] ?? null;
      } else if (c.const !== undefined) {
        row[c.name] = c.const;
      } else {
        row[c.name] = null;
      }
    });
    rows.push(row);
  }
  return rows;
}

export function generateTestData(
  spec: TestDataSpec,
  params: TestDataParams,
): QueryResultRow[] {
  switch (spec.scenario) {
    case "random_walk":
      return generateRandomWalk(spec, params);
    case "table":
      return generateTable(spec, params);
    case "csv":
      return spec.rows.map((row) => {
        const obj: QueryResultRow = {};
        spec.columns.forEach((col, i) => {
          obj[col] = row[i] ?? null;
        });
        return obj;
      });
  }
}
