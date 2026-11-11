/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The timeline is an inline SVG chart, which needs role="img" for its label; an <img> cannot hold it. */
import { Button } from "@everr/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";
import { TraceFlamegraph, type ViewRange } from "../../traces/ui/viewer/flamegraph";
import type { SpanProfileTarget } from "../../traces/ui/viewer/viewer";
import {
  profileSampleTypesOptions,
  profileSpanTimelineOptions,
  profileStacksOptions,
} from "../data/options";
import type { ProfilesRepositoryLike } from "../data/repository";
import type { ProfileFilterInput } from "../data/schemas";
import { profilesSearchForTrace } from "../data/trace-link";
import type { ProfileStacks, SampleTypeOption } from "../data/types";
import { FRAME_COLOR_KEY, frameId, frameRange, profileFlamegraph } from "../model/flame-layout";
import {
  buildFlameTree,
  findNodeByPath,
  functionStats,
  nodePath,
  stacksUnder,
} from "../model/flame-tree";
import { formatProfileValue } from "../model/format";
import { pickSampleType } from "../model/selection";
import { sourceLink } from "../model/source-link";
import { buildSpanTimeline, type SpanTimeline, type TimelineBucket } from "../model/span-timeline";
import { frameColor } from "./frame-color";
import { FrameMenuItems, PinnedFunction, useFunctionHighlight } from "./function-highlight";
import { displayUnit, FrameDetails } from "./profiles-explorer";
import { TopFunctionsTable } from "./top-functions-table";

export type SpanProfileProps = SpanProfileTarget & { repo: ProfilesRepositoryLike };

const MAX_HOVER_FRAMES = 12;

/** The samples a profiler took while one span was running, for the span details panel. */
export function SpanProfile({
  repo,
  traceId,
  spanId,
  window,
  spanStartNs,
  spanDurationNs,
}: SpanProfileProps) {
  const filters: ProfileFilterInput = useMemo(() => {
    const { from, to } = profilesSearchForTrace(traceId, window);
    return { timeRange: { from, to }, traceId, spanId, attributes: [] };
  }, [traceId, spanId, window]);
  const [requested, setRequested] = useState<SampleTypeOption | undefined>();

  const sampleTypesQuery = useQuery(profileSampleTypesOptions({ repo, refresh: "off", filters }));
  const sampleTypes = sampleTypesQuery.data ?? [];
  const sampleType = pickSampleType(sampleTypes, requested ?? {});
  const stacksQuery = useQuery(
    profileStacksOptions({
      repo,
      refresh: "off",
      filters,
      sampleType: sampleType?.sampleType,
      sampleUnit: sampleType?.sampleUnit,
    }),
  );
  const timelineQuery = useQuery(
    profileSpanTimelineOptions({
      repo,
      input: {
        timeRange: filters.timeRange,
        traceId,
        spanId,
        sampleType: sampleType?.sampleType ?? "",
        sampleUnit: sampleType?.sampleUnit ?? "",
      },
      enabled: sampleType !== undefined,
    }),
  );
  const timeline = useMemo(
    () =>
      timelineQuery.data
        ? buildSpanTimeline(
            timelineQuery.data.stacks,
            { startNs: BigInt(spanStartNs), durationNs: spanDurationNs },
            timelineQuery.data.periodNs,
          )
        : undefined,
    [timelineQuery.data, spanStartNs, spanDurationNs],
  );

  if (sampleTypesQuery.isPending) return <LoadingState />;
  if (sampleTypesQuery.isError || stacksQuery.isError) {
    const error = sampleTypesQuery.error ?? stacksQuery.error;
    return (
      <RetryError
        title="Could not load the span profile"
        message={error?.message ?? "Unknown error"}
        onRetry={() => {
          void sampleTypesQuery.refetch();
          void stacksQuery.refetch();
        }}
      />
    );
  }
  if (!sampleType) return <NoSamples />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sampleTypes.length > 1 ? (
        <fieldset
          className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5"
          aria-label="Sample type"
        >
          {sampleTypes.map((option) => {
            const active =
              option.sampleType === sampleType.sampleType &&
              option.sampleUnit === sampleType.sampleUnit;
            return (
              <Button
                key={`${option.sampleType}\u0000${option.sampleUnit}`}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={active}
                onClick={() => setRequested(option)}
              >
                {option.sampleType}
              </Button>
            );
          })}
        </fieldset>
      ) : null}
      {timeline && timeline.samples > 0 ? (
        <SpanTimelineChart
          timeline={timeline}
          durationNs={spanDurationNs}
          truncated={timelineQuery.data?.truncated ?? false}
        />
      ) : null}
      {stacksQuery.isPending ? (
        <LoadingState />
      ) : stacksQuery.data.stacks.length === 0 ? (
        <NoSamples />
      ) : (
        <SpanFlamegraph
          key={`${sampleType.sampleType}\u0000${sampleType.sampleUnit}`}
          data={stacksQuery.data}
          unit={displayUnit(sampleType)}
        />
      )}
    </div>
  );
}

function SpanFlamegraph({ data, unit }: { data: ProfileStacks; unit: string }) {
  const tree = useMemo(() => buildFlameTree(data.stacks), [data.stacks]);
  const flamegraph = useMemo(() => profileFlamegraph(tree), [tree]);
  const stats = useMemo(() => functionStats(data.stacks), [data.stacks]);
  const statsByKey = useMemo(() => new Map(stats.map((stat) => [stat.key, stat])), [stats]);
  const highlight = useFunctionHighlight(flamegraph.nodes);
  const [zoomPath, setZoomPath] = useState<string[]>([]);
  const [pannedRange, setPannedRange] = useState<ViewRange | null>(null);
  const focus = findNodeByPath(tree.root, zoomPath);
  const range = pannedRange ?? frameRange(focus);
  const total = tree.root.total;
  const zoomed = focus.parent !== undefined || pannedRange !== null;
  // Zoomed into a frame, the table lists only the functions under it.
  const tablePath = useMemo(() => (focus.parent ? nodePath(focus) : undefined), [focus]);
  const tableStats = useMemo(
    () => (tablePath ? functionStats(stacksUnder(data.stacks, tablePath)) : stats),
    [data.stacks, stats, tablePath],
  );

  const zoomTo = (path: string[]) => {
    setPannedRange(null);
    setZoomPath(path);
  };
  const sourceUrlOf = (key: string) => {
    const stat = statsByKey.get(key);
    return stat && stat.source !== undefined
      ? sourceLink(data.sources?.[stat.source], stat.file, stat.line)
      : undefined;
  };

  return (
    <>
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {formatProfileValue(total, unit)} in {data.stacks.length.toLocaleString("en-US")} stacks
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {highlight.pinned ? (
            <PinnedFunction fn={highlight.pinned} onClear={highlight.clearPin} />
          ) : null}
          {zoomed ? (
            <Button variant="outline" size="sm" onClick={() => zoomTo([])}>
              <ZoomOut data-icon="inline-start" />
              Reset zoom
            </Button>
          ) : null}
        </span>
      </div>
      <div className="min-h-40 flex-[3]">
        <TraceFlamegraph
          model={flamegraph}
          layout={flamegraph.layout}
          selectedSpanId={focus.parent ? frameId(focus) : undefined}
          {...highlight.flamegraph}
          colorBy={FRAME_COLOR_KEY}
          range={range}
          onRangeChange={setPannedRange}
          onSelect={(id) => {
            const node = flamegraph.nodes.get(id);
            if (node) zoomTo(nodePath(node));
          }}
          renderContextMenu={(id) => {
            const node = flamegraph.nodes.get(id);
            if (!node) return null;
            return (
              <FrameMenuItems
                node={node}
                pinned={highlight.pinned?.key === node.key}
                sourceUrl={sourceUrlOf(node.key)}
                onZoom={() => zoomTo(nodePath(node))}
                onResetZoom={() => zoomTo([])}
                onTogglePin={() =>
                  highlight.togglePin({ key: node.key, name: node.name, file: node.file })
                }
              />
            );
          }}
          formatValue={(value) => formatProfileValue(value, unit)}
          timeAxis={false}
          renderHover={(span) => {
            const node = flamegraph.nodes.get(span.spanId);
            return node ? <FrameDetails node={node} unit={unit} total={total} /> : null;
          }}
          ariaLabel="Span profile flame graph. Click a frame to zoom into it, pinch to zoom, drag to pan, double-click to reset."
        />
      </div>
      <div className="min-h-0 flex-[2] overflow-y-auto border-t">
        {tablePath ? (
          <p className="text-muted-foreground border-b px-3 py-1.5 text-xs">
            Functions under <span className="text-foreground font-mono">{focus.name}</span>
          </p>
        ) : null}
        <TopFunctionsTable
          stats={tableStats}
          unit={unit}
          total={tablePath ? focus.total : total}
          {...highlight.table}
          activateHint="Highlight in the flame graph"
          onActivate={highlight.togglePin}
          sourceUrlOf={sourceUrlOf}
        />
      </div>
    </>
  );
}

function SpanTimelineChart({
  timeline,
  durationNs,
  truncated,
}: {
  timeline: SpanTimeline;
  durationNs: number;
  truncated: boolean;
}) {
  const [hovered, setHovered] = useState<TimelineBucket | undefined>();
  const byIndex = useMemo(
    () => new Map(timeline.buckets.map((bucket) => [bucket.index, bucket])),
    [timeline],
  );
  const samples = timeline.samples.toLocaleString("en-US");

  return (
    <div className="relative shrink-0 border-b px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">Timeline</span>
        <span className="text-muted-foreground tabular-nums">
          {truncated ? `First ${samples} samples` : `${samples} samples`}, colored by the package of
          the running function
        </span>
      </div>
      <svg
        role="img"
        aria-label={`Timeline of ${samples} samples across the span's ${formatProfileValue(durationNs, "nanoseconds")}. Hover a bar for the function running at that time.`}
        viewBox={`0 0 ${timeline.bucketCount} 1`}
        preserveAspectRatio="none"
        className="bg-muted block h-6 w-full rounded-sm"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const index = Math.floor(
            ((event.clientX - rect.left) / rect.width) * timeline.bucketCount,
          );
          setHovered(byIndex.get(index));
        }}
        onPointerLeave={() => setHovered(undefined)}
      >
        {timeline.buckets.map((bucket) => (
          <rect
            key={bucket.index}
            x={bucket.index}
            y={0}
            width={1}
            height={1}
            style={{ fill: frameColor(bucket.leaf) }}
            opacity={hovered && hovered !== bucket ? 0.45 : 1}
          />
        ))}
      </svg>
      <div className="text-muted-foreground mt-0.5 flex justify-between font-mono text-[10px] tabular-nums">
        <span>0</span>
        <span>{formatProfileValue(durationNs, "nanoseconds")}</span>
      </div>
      {hovered ? (
        <TimelineHover bucket={hovered} bucketNs={timeline.bucketNs} durationNs={durationNs} />
      ) : null}
    </div>
  );
}

function TimelineHover({
  bucket,
  bucketNs,
  durationNs,
}: {
  bucket: TimelineBucket;
  bucketNs: number;
  durationNs: number;
}) {
  const start = bucket.index * bucketNs;
  const end = Math.min(durationNs, start + bucketNs);
  const callers = bucket.stack.frames.slice(0, -1).reverse();
  const shown = callers.slice(0, MAX_HOVER_FRAMES);
  return (
    <div className="bg-popover text-popover-foreground pointer-events-none absolute inset-x-3 top-full z-10 mt-1 rounded-md border p-2 shadow-md">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-sm"
          style={{ backgroundColor: frameColor(bucket.leaf) }}
        />
        <span className="font-mono font-medium break-all">{bucket.leaf}</span>
      </div>
      <div className="text-muted-foreground mt-0.5 tabular-nums">
        +{formatProfileValue(start, "nanoseconds")} to +{formatProfileValue(end, "nanoseconds")},{" "}
        {bucket.samples === 1 ? "1 sample" : `${bucket.samples} samples`}
      </div>
      {shown.length > 0 ? (
        <ol className="text-muted-foreground mt-1 border-t pt-1 font-mono text-[10px]">
          {shown.map((frame, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- Recursive stacks repeat frames; the depth tells them apart.
            <li key={`${frame.name}-${i}`} className="truncate">
              {frame.name}
            </li>
          ))}
          {callers.length > shown.length ? (
            <li>{callers.length - shown.length} more callers</li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-1 p-3" aria-busy="true">
      {[100, 88, 72, 52, 30].map((width) => (
        <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

function NoSamples() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No profile samples were taken during this span</EmptyTitle>
        <EmptyDescription>
          Profilers sample at about 100 Hz, once every 10 ms, so spans shorter than about 10 ms
          rarely have any. Samples are linked to a span only when the profiler records the active
          trace context.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
