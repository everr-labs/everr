import { useCallback, useMemo, useState } from "react";
import type { Span } from "@/data/traces/types";

export type TimelineRow = {
  span: Span;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
};

// timestampNs is a unix-ns string (added explicitly by the SQL).
// Never use BigInt(span.timestamp) — that's a DateTime string.
function compareSpans(a: Span, b: Span): number {
  const at = BigInt(a.timestampNs);
  const bt = BigInt(b.timestampNs);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
}

// Roots = explicit roots (parentSpanId === "") + orphan roots whose parent
// is missing from the trace (retention boundary or window clipped it).
export function pickRoots(spans: Span[]): Span[] {
  const knownIds = new Set<string>();
  for (const s of spans) knownIds.add(s.spanId);
  const roots: Span[] = [];
  for (const s of spans) {
    if (s.parentSpanId === "" || !knownIds.has(s.parentSpanId)) {
      roots.push(s);
    }
  }
  roots.sort(compareSpans);
  return roots;
}

export function pickRootSpan(spans: Span[]): Span | undefined {
  return pickRoots(spans)[0] ?? spans[0];
}

type TreeEntry = { span: Span; depth: number; hasChildren: boolean };

export function useTimelineLayout(spans: Span[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Static structure: depends only on the spans array. Pre-flatten into DFS
  // order so the collapse pass below is a single linear scan instead of a
  // full tree rebuild on every toggle.
  const tree = useMemo(() => {
    const byParent = new Map<string, Span[]>();
    for (const s of spans) {
      const arr = byParent.get(s.parentSpanId) ?? [];
      arr.push(s);
      byParent.set(s.parentSpanId, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort(compareSpans);
    }

    const roots = pickRoots(spans);

    const entries: TreeEntry[] = [];
    for (const root of roots) {
      const stack: { span: Span; depth: number }[] = [{ span: root, depth: 0 }];
      while (stack.length > 0) {
        const frame = stack.pop();
        if (!frame) break;
        const { span, depth } = frame;
        const children = byParent.get(span.spanId) ?? [];
        entries.push({ span, depth, hasChildren: children.length > 0 });
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (!child) continue;
          stack.push({ span: child, depth: depth + 1 });
        }
      }
    }

    let startBig: bigint | undefined;
    let endBig = 0n;
    for (const s of spans) {
      const t = BigInt(s.timestampNs);
      const end = t + BigInt(s.duration);
      if (startBig === undefined || t < startBig) startBig = t;
      if (end > endBig) endBig = end;
    }

    return {
      entries,
      traceStartNs: startBig ?? 0n,
      traceEndNs: endBig,
    };
  }, [spans]);

  // Filtered rows: linear scan, skip subtrees whose ancestor was collapsed.
  const rows = useMemo<TimelineRow[]>(() => {
    if (collapsed.size === 0) {
      return tree.entries.map((e) => ({
        span: e.span,
        depth: e.depth,
        hasChildren: e.hasChildren,
        collapsed: false,
      }));
    }
    const out: TimelineRow[] = [];
    let skipDepth = -1;
    for (const e of tree.entries) {
      if (skipDepth >= 0 && e.depth > skipDepth) continue;
      skipDepth = -1;
      const isCollapsed = collapsed.has(e.span.spanId);
      out.push({
        span: e.span,
        depth: e.depth,
        hasChildren: e.hasChildren,
        collapsed: isCollapsed,
      });
      if (isCollapsed) skipDepth = e.depth;
    }
    return out;
  }, [tree, collapsed]);

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  return {
    rows,
    traceStartNs: tree.traceStartNs,
    traceEndNs: tree.traceEndNs,
    toggleCollapse,
  };
}
