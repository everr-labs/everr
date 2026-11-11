import type { VisualLayout } from "../../traces/ui/viewer/rendering/compute-visual-layout";
import type { FlamegraphSpan } from "../../traces/ui/viewer/rendering/types";
import type { FlameNode, FlameTree } from "./flame-tree";

/** The attribute the trace flame graph's `colorBy` reads to color a frame. */
export const FRAME_COLOR_KEY = "everr.profile.frame.package";

export type ProfileFlamegraph = {
  layout: VisualLayout;
  /** The full x extent, in the trace flame graph's millisecond units. */
  durationMs: number;
  nodes: ReadonlyMap<string, FlameNode>;
};

/**
 * The package or class part of a function name, so frames of one module share a
 * color: `github.com/acme/api.(*Server).Serve` and `runtime.mallocgc` (Go),
 * `com.acme.Server.serve` (JVM), `tokio::runtime::park` (Rust, C++).
 */
export function framePackage(name: string): string {
  const base = name.split("(")[0] ?? name;
  const slash = base.lastIndexOf("/");
  if (slash >= 0) {
    const dot = base.indexOf(".", slash);
    return dot >= 0 ? base.slice(0, dot) : base;
  }
  const scope = base.lastIndexOf("::");
  if (scope > 0) return base.slice(0, scope);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Lays a profile out for the trace flame graph. That component places bars by
 * `timestamp` (ms) and `durationNano`, so a frame's offset and weight go there,
 * and the weight reads back unchanged from `durationNano`. The trace layout
 * packs overlapping spans and moves subtrees to dodge connectors, so it does
 * not keep one row per call depth; a profile needs exactly that, and its
 * siblings never overlap, so the rows are just the depths. `inverted` puts the
 * root on the bottom row, for a function's callers growing upward.
 */
export function profileFlamegraph(
  tree: FlameTree,
  { inverted = false }: { inverted?: boolean } = {},
): ProfileFlamegraph {
  const visualRows: FlamegraphSpan[][] = Array.from({ length: tree.maxDepth + 1 }, () => []);
  const spanToVisualRow: Record<string, number> = {};
  const nodes = new Map<string, FlameNode>();

  const visit = (node: FlameNode, parentId: string) => {
    const { id } = node;
    nodes.set(id, node);
    const row = inverted ? tree.maxDepth - node.depth : node.depth;
    spanToVisualRow[id] = row;
    visualRows[row]?.push({
      spanId: id,
      parentSpanId: parentId,
      name: node.name,
      timestamp: node.start / 1e6,
      durationNano: node.total,
      hasError: false,
      resource: {},
      attributes: { [FRAME_COLOR_KEY]: framePackage(node.name) },
      event: [],
    });
    for (const child of node.children) visit(child, id);
  };
  visit(tree.root, "");

  return {
    layout: { visualRows, spanToVisualRow, connectors: [], totalVisualRows: visualRows.length },
    durationMs: tree.root.total / 1e6,
    nodes,
  };
}

/** The x range that shows `node` across the full width. */
export function frameRange(node: FlameNode): { start: number; end: number } {
  return { start: node.start / 1e6, end: (node.start + node.total) / 1e6 };
}
