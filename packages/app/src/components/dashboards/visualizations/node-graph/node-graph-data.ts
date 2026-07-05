import { isNumericValue } from "@/lib/numeric";
import { toNumber } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { NodeGraphSpec } from "./spec";

export interface GraphNode {
  id: string;
  /** Sum of the weights of every edge touching the node (in + out). */
  value: number;
  /** Distinct incoming / outgoing edge counts, for the tooltip. */
  inEdges: number;
  outEdges: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Summed weight of every row with this (source, target) pair. */
  value: number;
  /** False when the rows had no numeric weight and the value is a row count. */
  hasValue: boolean;
}

export interface NodeGraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Rows skipped for a missing source/target or a self-loop. */
  droppedRows: number;
  /** Nodes trimmed by `maxNodes` / the layout limit (edges removed with them). */
  hiddenNodes: number;
}

/** Force layout is O(n²) per iteration — past this it stops being readable
 *  (and starts being slow), so the largest nodes win and the rest are hidden. */
export const MAX_LAYOUT_NODES = 250;

// Separator for the (source, target) accumulator key — a control char no
// real node id contains, so ids with arrows or commas can't collide.
const SEP = "\u001f";

/**
 * A directed graph from every frame's edge-list rows (source column, target
 * column, optional numeric weight column). Rows with the same (source,
 * target) pair — within a frame or across frames — sum their weights; the
 * reverse direction is a distinct edge. Rows missing either endpoint, and
 * self-loops (source = target), are dropped and counted.
 *
 * Nodes are the distinct endpoints, valued by the total weight flowing
 * through them. When the result has more nodes than `maxNodes` (or the
 * layout limit), the highest-value nodes stay and the hidden count is
 * reported.
 */
export function buildNodeGraph(frames: QueryResultRow[][], spec: NodeGraphSpec): NodeGraphModel {
  const edgeSums = new Map<string, { value: number; hasValue: boolean }>();
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
    const valueKey =
      spec.valueColumn in first && spec.valueColumn !== sourceKey && spec.valueColumn !== targetKey
        ? spec.valueColumn
        : keys.find(
            (k) => k !== sourceKey && k !== targetKey && rows.some((row) => isNumericValue(row[k])),
          );

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
      const key = `${source}${SEP}${target}`;
      const entry = edgeSums.get(key) ?? { value: 0, hasValue: false };
      entry.value += weight ?? 1;
      entry.hasValue ||= weight !== null;
      edgeSums.set(key, entry);
    }
  }

  const nodeMap = new Map<string, GraphNode>();
  const node = (id: string): GraphNode => {
    let n = nodeMap.get(id);
    if (!n) {
      n = { id, value: 0, inEdges: 0, outEdges: 0 };
      nodeMap.set(id, n);
    }
    return n;
  };

  let edges: GraphEdge[] = [];
  for (const [key, { value, hasValue }] of edgeSums) {
    const [source, target] = key.split(SEP);
    edges.push({ source, target, value, hasValue });
    const s = node(source);
    const t = node(target);
    s.value += value;
    s.outEdges++;
    t.value += value;
    t.inEdges++;
  }

  let nodes = [...nodeMap.values()];
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
