import { Skeleton } from "@everr/ui/components/skeleton";
import { type ReactNode, useMemo, useState } from "react";
import { TraceFlamegraph, type ViewRange } from "../../traces/ui/viewer/flamegraph";
import type { ProfileStacks, SampleTypeOption } from "../data/types";
import { diffColorOf, type FrameDiff } from "../model/diff";
import {
  FRAME_COLOR_KEY,
  frameRange,
  type ProfileFlamegraph,
  profileFlamegraph,
} from "../model/flame-layout";
import {
  buildFlameTree,
  type FlameNode,
  findNodeByPath,
  functionStats,
  nodePath,
  stacksUnder,
} from "../model/flame-tree";
import { formatPercent, formatProfileValue } from "../model/format";
import { sourceLink } from "../model/source-link";
import { FrameMenuItems, useFunctionHighlight } from "./function-highlight";

const NO_MATCHES: ReadonlySet<string> = new Set();

/** A profile drawn with the trace flame graph's canvas, which takes frames as spans. */
export function ProfileFlamegraphView({
  flamegraph,
  unit,
  diffs,
  selected,
  highlight,
  range,
  onRangeChange,
  onSelect,
  renderHover,
  renderContextMenu,
  ariaLabel,
}: {
  flamegraph: ProfileFlamegraph;
  unit: string;
  /** Colors each frame by its change against a baseline. */
  diffs?: ReadonlyMap<string, FrameDiff>;
  selected?: FlameNode;
  highlight?: {
    matchingIds: ReadonlySet<string>;
    filterActive: boolean;
    onHoverChange: (id: string | undefined) => void;
  };
  range: ViewRange;
  onRangeChange: (range: ViewRange) => void;
  onSelect: (node: FlameNode) => void;
  renderHover: (node: FlameNode, diff: FrameDiff | undefined) => ReactNode;
  renderContextMenu?: (node: FlameNode) => ReactNode;
  ariaLabel: string;
}) {
  // Stable, so the canvas does not rebuild on every render of the parent.
  const formatValue = useMemo(() => (value: number) => formatProfileValue(value, unit), [unit]);
  const colorOf = useMemo(() => (diffs ? diffColorOf(diffs) : undefined), [diffs]);
  const nodeOf = (id: string) => flamegraph.nodes.get(id);

  return (
    <TraceFlamegraph
      model={flamegraph}
      layout={flamegraph.layout}
      selectedSpanId={selected?.parent ? selected.id : undefined}
      matchingIds={highlight?.matchingIds ?? NO_MATCHES}
      filterActive={highlight?.filterActive ?? false}
      onHoverChange={highlight?.onHoverChange}
      colorBy={FRAME_COLOR_KEY}
      colorOf={colorOf}
      timeAxis={false}
      formatValue={formatValue}
      range={range}
      onRangeChange={onRangeChange}
      onSelect={(id) => {
        const node = nodeOf(id);
        if (node) onSelect(node);
      }}
      renderContextMenu={
        renderContextMenu &&
        ((id) => {
          const node = nodeOf(id);
          return node ? renderContextMenu(node) : null;
        })
      }
      renderHover={(span) => {
        const node = nodeOf(span.spanId);
        return node ? renderHover(node, diffs?.get(span.spanId)) : null;
      }}
      ariaLabel={ariaLabel}
    />
  );
}

/**
 * The state a zoomable profile shares with its function table: the frame
 * zoomed into, the table scoped to that frame's subtree, and the functions
 * highlighted across both.
 */
export function useZoomableProfile(
  data: ProfileStacks,
  zoomPath: readonly string[],
  onZoom: (path: string[]) => void,
  { scopeTable = true }: { scopeTable?: boolean } = {},
) {
  const tree = useMemo(() => buildFlameTree(data.stacks), [data.stacks]);
  const flamegraph = useMemo(() => profileFlamegraph(tree), [tree]);
  const stats = useMemo(() => functionStats(data.stacks), [data.stacks]);
  const statsByKey = useMemo(() => new Map(stats.map((stat) => [stat.key, stat])), [stats]);
  const highlight = useFunctionHighlight(flamegraph.nodes);
  const focus = findNodeByPath(tree.root, zoomPath);
  // Wheel zoom and drag pan move the view off the zoomed frame until the next click.
  const [pannedRange, setPannedRange] = useState<ViewRange | null>(null);
  // Zoomed into a frame, the table lists only the functions under it, as
  // shares of it, to match what the flame graph shows.
  const tablePath = useMemo(
    () => (scopeTable && focus.parent ? nodePath(focus) : undefined),
    [scopeTable, focus],
  );
  const tableStats = useMemo(
    () => (tablePath ? functionStats(stacksUnder(data.stacks, tablePath)) : stats),
    [data.stacks, stats, tablePath],
  );

  const zoomTo = (path: string[]) => {
    setPannedRange(null);
    onZoom(path);
  };
  const sourceUrlOf = (key: string) => {
    const stat = statsByKey.get(key);
    if (!stat) return undefined;
    const source = stat.source === undefined ? undefined : data.sources?.[stat.source];
    return sourceLink(source, stat.file, stat.line);
  };

  return {
    tree,
    flamegraph,
    statsByKey,
    highlight,
    focus,
    zoomed: focus.parent !== undefined || pannedRange !== null,
    range: pannedRange ?? frameRange(focus),
    setPannedRange,
    zoomTo,
    tablePath,
    tableStats,
    tableTotal: tablePath ? focus.total : tree.root.total,
    sourceUrlOf,
    /** The right-click menu of a frame; `onShowCallers` adds callers and callees. */
    renderFrameMenu: (node: FlameNode, onShowCallers?: () => void) => (
      <FrameMenuItems
        node={node}
        pinned={highlight.pinned?.key === node.key}
        sourceUrl={sourceUrlOf(node.key)}
        onZoom={() => zoomTo(nodePath(node))}
        onResetZoom={() => zoomTo([])}
        onTogglePin={() => highlight.togglePin({ key: node.key, name: node.name, file: node.file })}
        onShowCallers={onShowCallers}
      />
    ),
  };
}

/** Caption over a function table scoped to a zoomed frame. */
export function ScopedTableCaption({ frame }: { frame: FlameNode }) {
  return (
    <p className="text-muted-foreground border-b px-3 py-1.5 text-xs">
      Functions under <span className="text-foreground font-mono">{frame.name}</span>, as shares of
      it
    </p>
  );
}

/** A frame or function's location and weight. */
export function FrameDetails({
  frame,
  unit,
  total,
}: {
  frame: Pick<FlameNode, "name" | "file" | "line" | "total" | "self">;
  unit: string;
  total: number;
}) {
  const location = frame.file ? (frame.line > 0 ? `${frame.file}:${frame.line}` : frame.file) : "";
  return (
    <>
      <div className="font-mono font-medium break-all">{frame.name}</div>
      {location ? (
        <div className="text-muted-foreground mt-1 font-mono break-all">{location}</div>
      ) : null}
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">Total</dt>
        <dd>
          {formatProfileValue(frame.total, unit)} ({formatPercent(frame.total, total)})
        </dd>
        <dt className="text-muted-foreground">Self</dt>
        <dd>
          {formatProfileValue(frame.self, unit)} ({formatPercent(frame.self, total)})
        </dd>
      </dl>
    </>
  );
}

// `count` reads as samples, which suits CPU sample counts but not heap objects.
export function displayUnit(option: SampleTypeOption): string {
  return option.sampleType.endsWith("_objects") ? "objects" : option.sampleUnit;
}

export function ProfileLoading() {
  return (
    <div className="flex flex-col gap-1 p-3" aria-busy="true">
      {[100, 92, 80, 64, 40, 24].map((width) => (
        <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}
