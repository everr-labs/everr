import type { Span } from "@/data/runs";

export interface SpanNode extends Span {
  depth: number;
  children: SpanNode[];
}

export function buildSpanTree(spans: Span[]): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes for all spans
  for (const span of spans) {
    spanMap.set(span.spanId, { ...span, depth: 0, children: [] });
  }

  // Build parent-child relationships
  for (const span of spans) {
    const node = spanMap.get(span.spanId);
    if (!node) continue;

    const parent = spanMap.get(span.parentSpanId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Calculate depths
  function setDepth(node: SpanNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }

  for (const root of roots) {
    setDepth(root, 0);
  }

  return roots;
}

export function flattenTree(
  nodes: SpanNode[],
  collapsed: Set<string>,
): SpanNode[] {
  const result: SpanNode[] = [];

  function traverse(node: SpanNode) {
    result.push(node);
    // Skip children if this node is collapsed
    if (collapsed.has(node.spanId)) return;

    // Sort children by start time
    const sortedChildren = [...node.children].sort(
      (a, b) => a.startTime - b.startTime,
    );
    for (const child of sortedChildren) {
      traverse(child);
    }
  }

  // Sort roots by start time
  const sortedRoots = [...nodes].sort((a, b) => a.startTime - b.startTime);
  for (const root of sortedRoots) {
    traverse(root);
  }

  return result;
}

export function getParentSpanIds(nodes: SpanNode[]): Set<string> {
  const parents = new Set<string>();

  function traverse(node: SpanNode) {
    if (node.children.length > 0) {
      parents.add(node.spanId);
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const root of nodes) {
    traverse(root);
  }

  return parents;
}

export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
