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

export function useTimelineLayout(spans: Span[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const layout = useMemo(() => {
    const byParent = new Map<string, Span[]>();
    const knownIds = new Set<string>();
    for (const s of spans) {
      knownIds.add(s.spanId);
      const arr = byParent.get(s.parentSpanId) ?? [];
      arr.push(s);
      byParent.set(s.parentSpanId, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort(compareSpans);
    }

    // Roots = explicit roots (parentSpanId === "") + orphan roots whose
    // parent is missing (retention boundary or window clipped the parent).
    const roots: Span[] = [];
    for (const s of spans) {
      if (s.parentSpanId === "" || !knownIds.has(s.parentSpanId)) {
        roots.push(s);
      }
    }
    roots.sort(compareSpans);

    const rows: TimelineRow[] = [];
    for (const root of roots) {
      const stack: { span: Span; depth: number; hidden: boolean }[] = [
        { span: root, depth: 0, hidden: false },
      ];
      while (stack.length > 0) {
        const frame = stack.pop();
        if (!frame) break;
        const { span, depth, hidden } = frame;
        const children = byParent.get(span.spanId) ?? [];
        if (!hidden) {
          rows.push({
            span,
            depth,
            hasChildren: children.length > 0,
            collapsed: collapsed.has(span.spanId),
          });
        }
        const childHidden = hidden || collapsed.has(span.spanId);
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (!child) continue;
          stack.push({
            span: child,
            depth: depth + 1,
            hidden: childHidden,
          });
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
      rows,
      traceStartNs: startBig ?? 0n,
      traceEndNs: endBig,
    };
  }, [spans, collapsed]);

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

  return { ...layout, toggleCollapse };
}
