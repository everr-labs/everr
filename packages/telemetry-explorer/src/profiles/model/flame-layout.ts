import type { VisualLayout } from "../../traces/ui/viewer/rendering/compute-visual-layout";
import type { FlamegraphSpan } from "../../traces/ui/viewer/rendering/types";
import { framePackage } from "../ui/frame-color";
import { type FlameNode, type FlameTree, nodePath } from "./flame-tree";

/** The attribute the trace flame graph's `colorBy` reads to color a frame. */
export const FRAME_COLOR_KEY = "everr.profile.frame.package";

export type ProfileFlamegraph = {
  layout: VisualLayout;
  /** The full x extent, in the trace flame graph's millisecond units. */
  durationMs: number;
  nodes: ReadonlyMap<string, FlameNode>;
};

/** Ids are the frame path, so a selection survives a refetch of the same stacks. */
export function frameId(node: FlameNode): string {
  return ["frame", ...nodePath(node)].join("\u0001");
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
    const id = frameId(node);
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
