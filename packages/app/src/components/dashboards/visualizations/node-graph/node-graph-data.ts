import { isNumericValue } from "#app/lib/numeric.ts";
import { toNumber } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { NodeGraphSpec } from "./spec";

export interface GraphNode {
  id: string;
  /** The weight flowing through the node: the larger of its total incoming
   * and total outgoing edge weight. */
  value: number;
  /** Distinct incoming / outgoing edge counts, for the tooltip. */
  inEdges: number;
  outEdges: number;
  /** The spec's stats over the calls the node receives; absent without
   * stats, or for a node nothing calls. */
  health?: Health;
}

export type HealthLevel = "ok" | "warning" | "critical";

export interface StatValue {
  /** The stat's column, which is also its label. */
  column: string;
  value: number;
  /** Where the value falls against the stat's thresholds, if it has any. */
  level?: HealthLevel;
}

export interface Health {
  /** The spec's stats, in order, leaving out any with no data here. */
  stats: StatValue[];
  /** The worst level of any stat. */
  level?: HealthLevel;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Summed weight of every row with this (source, target) pair. */
  value: number;
  /** False when the rows had no numeric weight and the value is a row count. */
  hasValue: boolean;
  health?: Health;
}

type StatSpec = NodeGraphSpec["stats"][number];

const SEVERITY: Record<HealthLevel, number> = { ok: 0, warning: 1, critical: 2 };

/** Thresholds rising from warning to critical flag high values; falling,
 * low ones (a drop in throughput, say). */
function grade(value: number, [warning, critical]: [number, number]): HealthLevel {
  const worse =
    warning <= critical ? (v: number, t: number) => v >= t : (v: number, t: number) => v <= t;
  return worse(value, critical) ? "critical" : worse(value, warning) ? "warning" : "ok";
}

/** Running totals behind a stat: `total` over `weight` gives a mean or rate. */
interface StatSums {
  total: number;
  weight: number;
}

/** One row's contribution to a stat, given the calls the row stands for. */
function contribution(reduce: StatSpec["reduce"], value: number, calls: number): StatSums {
  switch (reduce) {
    case "sum":
      // The weight is unused: a sum is its total.
      return { total: value, weight: 0 };
    case "rate":
      return { total: value, weight: calls };
    case "mean":
      return { total: value * calls, weight: calls };
  }
}

function addSums(into: (StatSums | undefined)[], from: (StatSums | undefined)[]) {
  from.forEach((sums, i) => {
    if (!sums) return;
    const current = into[i] ?? { total: 0, weight: 0 };
    into[i] = { total: current.total + sums.total, weight: current.weight + sums.weight };
  });
}

function toHealth(sums: (StatSums | undefined)[], stats: StatSpec[]): Health | undefined {
  const values: StatValue[] = [];
  stats.forEach((stat, i) => {
    const s = sums[i];
    if (!s) return;
    if (stat.reduce !== "sum" && s.weight <= 0) return;
    const value = stat.reduce === "sum" ? s.total : s.total / s.weight;
    values.push({
      column: stat.column,
      value,
      level: stat.thresholds && grade(value, stat.thresholds),
    });
  });
  if (!values.length) return undefined;
  const level = values
    .map((v) => v.level)
    .filter((l) => l !== undefined)
    .reduce<HealthLevel | undefined>(
      (worst, l) => (worst === undefined || SEVERITY[l] > SEVERITY[worst] ? l : worst),
      undefined,
    );
  return { stats: values, level };
}

export interface NodeGraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Rows skipped for a missing source/target or a self-loop. */
  droppedRows: number;
  /** Nodes trimmed by `maxNodes` / the layout limit (edges removed with them). */
  hiddenNodes: number;
}

/** Past this the graph stops being readable (and the layout starts being
 *  slow), so the largest nodes win and the rest are hidden. */
const MAX_LAYOUT_NODES = 250;

/** An edge's identity: a control character no real node id contains joins
 * the pair, so ids with arrows or commas can't collide. */
export const edgeKey = (source: string, target: string) => `${source}\u001f${target}`;

/**
 * A directed graph from every frame's edge-list rows (source column, target
 * column, optional numeric weight column). Rows with the same (source,
 * target) pair — within a frame or across frames — sum their weights; the
 * reverse direction is a distinct edge. Rows missing either endpoint, and
 * self-loops (source = target), are dropped and counted.
 *
 * Nodes are the distinct endpoints, valued by the weight flowing through
 * them (the larger of their incoming and outgoing totals). When the result
 * has more nodes than `maxNodes` (or the layout limit), the highest-value
 * nodes stay and the hidden count is reported.
 */
export function buildNodeGraph(frames: QueryResultRow[][], spec: NodeGraphSpec): NodeGraphModel {
  const edgeSums = new Map<
    string,
    {
      source: string;
      target: string;
      value: number;
      hasValue: boolean;
      sums: (StatSums | undefined)[];
    }
  >();
  let droppedRows = 0;

  for (const rows of frames) {
    if (!rows || rows.length === 0) continue;
    const first = rows[0];
    const keys = Object.keys(first);

    const sourceKey = spec.sourceColumn in first ? spec.sourceColumn : keys[0];
    if (sourceKey === undefined) continue;
    const targetKey =
      spec.targetColumn in first && spec.targetColumn !== sourceKey
        ? spec.targetColumn
        : keys.find((k) => k !== sourceKey);
    if (targetKey === undefined) continue;
    const statKeys = spec.stats.map((stat) => (stat.column in first ? stat.column : undefined));
    const taken = new Set([sourceKey, targetKey, ...statKeys]);
    const valueKey =
      spec.valueColumn in first && !taken.has(spec.valueColumn)
        ? spec.valueColumn
        : keys.find((k) => !taken.has(k) && rows.some((row) => isNumericValue(row[k])));

    for (const row of rows) {
      const source = row[sourceKey];
      const target = row[targetKey];
      if (
        source == null ||
        target == null ||
        source === "" ||
        target === "" ||
        String(source) === String(target)
      ) {
        droppedRows++;
        continue;
      }
      const weight = valueKey === undefined ? null : toNumber(row[valueKey]);
      const pair = { source: String(source), target: String(target) };
      const key = edgeKey(pair.source, pair.target);
      const entry = edgeSums.get(key) ?? { ...pair, value: 0, hasValue: false, sums: [] };
      const calls = weight ?? 1;
      entry.value += calls;
      entry.hasValue ||= weight !== null;
      addSums(
        entry.sums,
        spec.stats.map((stat, i) => {
          const column = statKeys[i];
          const value = column === undefined ? null : toNumber(row[column]);
          return value === null ? undefined : contribution(stat.reduce, value, calls);
        }),
      );
      edgeSums.set(key, entry);
    }
  }

  const nodeMap = new Map<
    string,
    GraphNode & { in: number; out: number; received: (StatSums | undefined)[] }
  >();
  const node = (id: string) => {
    let n = nodeMap.get(id);
    if (!n) {
      n = { id, value: 0, inEdges: 0, outEdges: 0, in: 0, out: 0, received: [] };
      nodeMap.set(id, n);
    }
    return n;
  };

  let edges: GraphEdge[] = [];
  for (const { source, target, value, hasValue, sums } of edgeSums.values()) {
    edges.push({ source, target, value, hasValue, health: toHealth(sums, spec.stats) });
    const s = node(source);
    const t = node(target);
    s.out += value;
    s.outEdges++;
    // A node's stats are those of the calls it serves.
    addSums(t.received, sums);
    t.in += value;
    t.inEdges++;
  }

  let nodes: GraphNode[] = [...nodeMap.values()].map(({ in: inValue, out, received, ...n }) => ({
    ...n,
    value: Math.max(inValue, out),
    health: toHealth(received, spec.stats),
  }));
  const cap = Math.min(spec.maxNodes ?? Infinity, MAX_LAYOUT_NODES);
  let hiddenNodes = 0;
  if (nodes.length > cap) {
    hiddenNodes = nodes.length - cap;
    nodes = [...nodes].sort((a, b) => b.value - a.value).slice(0, cap);
    const kept = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }

  return { nodes, edges, droppedRows, hiddenNodes };
}
