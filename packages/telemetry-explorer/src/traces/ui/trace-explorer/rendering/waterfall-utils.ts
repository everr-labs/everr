// Third-party attribution and license: see the root NOTICE and LICENSE in this directory.
// SPDX-License-Identifier: MIT
// Adapted for Everr. See README.md for upstream provenance and changes.

import type { WaterfallSpan } from "./types";

/**
 * Computes the visible spans from a complete span list based on collapse state.
 *
 * Relies on spans being in DFS pre-order (produced by buildTraceModel).
 * When a collapsed span is encountered, all its descendants (level > collapsed span's level)
 * are skipped until we reach a sibling or ancestor (level <= collapsed span's level).
 *
 * The strict `>` comparison means "skip children, not siblings" — a span at the same
 * level as the collapsed span passes through because DFS order guarantees all descendants
 * appear contiguously before the next sibling.
 */
export function getVisibleSpans<T extends WaterfallSpan>(
  allSpans: T[],
  uncollapsedNodes: Set<string>,
): T[] {
  const visible: T[] = [];
  let skipBelowLevel = Infinity;

  for (const span of allSpans) {
    if (span.level > skipBelowLevel) {
      continue;
    }
    skipBelowLevel = Infinity;
    visible.push(span);

    if (span.hasChildren && !uncollapsedNodes.has(span.spanId)) {
      skipBelowLevel = span.level;
    }
  }

  return visible;
}

/**
 * Returns the set of ancestor span IDs for a given span.
 * Walks up the tree via parentSpanId until reaching the root.
 */
export function getAncestorSpanIds(
  allSpans: WaterfallSpan[],
  targetSpanId: string,
): Set<string> {
  const spanMap = new Map<string, WaterfallSpan>();
  for (const span of allSpans) {
    spanMap.set(span.spanId, span);
  }

  const ancestors = new Set<string>();
  let current = spanMap.get(targetSpanId);

  while (current?.parentSpanId) {
    const parent = spanMap.get(current.parentSpanId);
    if (!parent) {
      break;
    }
    if (ancestors.has(parent.spanId)) break;
    ancestors.add(parent.spanId);
    current = parent;
  }

  return ancestors;
}
