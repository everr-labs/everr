import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Focus,
  Timer,
  X,
} from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { Span } from "@/data/runs/schemas";
import { formatDuration, parseDuration } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { ConclusionIcon } from "./conclusion-icon";
import { FrameworkIcon } from "./framework-icon";
import { SpanDetailPanel } from "./span-detail-panel";
import {
  buildSpanTree,
  flattenTree,
  getParentSpanIds,
  stringToColor,
} from "./trace-waterfall-utils";

interface TraceWaterfallProps {
  spans: Span[];
  traceId: string;
  flakyTestNames?: string[];
}

export function TraceWaterfall({
  spans,
  traceId,
  flakyTestNames,
}: TraceWaterfallProps) {
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null);
  const [durationFilter, setDurationFilter] = useState("");
  const [detailHeight, setDetailHeight] = useState(0);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const scrollSourceRef = useRef<"left" | "right" | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const flakySet = useMemo(
    () => new Set(flakyTestNames ?? []),
    [flakyTestNames],
  );

  const minDuration = useMemo(
    () => parseDuration(durationFilter) ?? 0,
    [durationFilter],
  );

  const { tree, parentSpanIds } = useMemo(() => {
    const builtTree = buildSpanTree(spans);
    const parents = getParentSpanIds(builtTree);
    return { tree: builtTree, parentSpanIds: parents };
  }, [spans]);

  const focusedSpan = focusedSpanId
    ? spans.find((s) => s.spanId === focusedSpanId)
    : null;

  const { minTime, totalDuration } = useMemo(() => {
    if (focusedSpanId) {
      const focused = spans.find((s) => s.spanId === focusedSpanId);
      if (focused) {
        return { minTime: focused.startTime, totalDuration: focused.duration };
      }
    }
    const times = spans.flatMap((s) => [s.startTime, s.endTime]);
    const min = Math.min(...times);
    return { minTime: min, totalDuration: Math.max(...times) - min };
  }, [spans, focusedSpanId]);

  const flatSpans = useMemo(
    () => flattenTree(tree, collapsedSpans),
    [tree, collapsedSpans],
  );

  const filteredSpans = useMemo(() => {
    if (minDuration <= 0) return flatSpans;
    return flatSpans.filter((s) => s.duration >= minDuration);
  }, [flatSpans, minDuration]);

  const toggleCollapse = (spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedSpans(new Set());
  const collapseAll = () => setCollapsedSpans(new Set(parentSpanIds));

  const toggleSelection = (spanId: string) => {
    setSelectedSpanId((prev) => (prev === spanId ? null : spanId));
  };

  const syncScroll = (source: "left" | "right") => {
    if (scrollSourceRef.current && scrollSourceRef.current !== source) return;
    scrollSourceRef.current = source;
    const from =
      source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to =
      source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (from && to) to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      scrollSourceRef.current = null;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedSpanId triggers remeasure when detail panel appears/disappears
  useLayoutEffect(() => {
    if (detailRef.current) {
      setDetailHeight(detailRef.current.offsetHeight);
    } else {
      setDetailHeight(0);
    }
  }, [selectedSpanId]);

  // Generate time markers
  const markerCount = 5;
  const markers = Array.from({ length: markerCount + 1 }, (_, i) => {
    const fraction = i / markerCount;
    const time = totalDuration * fraction;
    return { fraction, label: formatDuration(time, "ms") };
  });

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={expandAll}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-7 gap-1 px-2 text-xs",
          )}
        >
          <ChevronsUpDown className="size-3.5" />
          Expand All
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-7 gap-1 px-2 text-xs",
          )}
        >
          <ChevronsDownUp className="size-3.5" />
          Collapse All
        </button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Timer className="size-3.5" />
          <Input
            type="text"
            placeholder="e.g. 200ms"
            aria-label="Minimum duration"
            className="h-7 w-24 px-1.5 text-xs"
            value={durationFilter}
            onChange={(e) => setDurationFilter(e.target.value)}
          />
        </div>
        {minDuration > 0 && filteredSpans.length !== flatSpans.length && (
          <span className="text-xs text-muted-foreground">
            {filteredSpans.length} of {flatSpans.length} spans
          </span>
        )}
        {focusedSpan && (
          <Badge variant="outline" className="gap-1">
            <Focus className="size-2.5" data-icon="inline-start" />
            <span className="max-w-40 truncate">{focusedSpan.name}</span>
            <button
              type="button"
              title="Clear focus"
              onClick={() => setFocusedSpanId(null)}
              className="rounded-full hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="size-2.5" data-icon="inline-end" />
            </button>
          </Badge>
        )}
      </div>

      {/* Resizable panels */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* Left panel — span names */}
        <ResizablePanel>
          <div
            ref={leftScrollRef}
            className="h-full overflow-y-auto overflow-x-hidden"
            onScroll={() => syncScroll("left")}
          >
            {/* Spacer matching time-axis height */}
            <div className="sticky top-0 z-10 h-5 bg-card border-b border-border" />
            {filteredSpans.map((span) => {
              const hasChildren = parentSpanIds.has(span.spanId);
              const isCollapsed = collapsedSpans.has(span.spanId);
              const isSelected = selectedSpanId === span.spanId;

              return (
                <Fragment key={span.spanId}>
                  <div
                    className={cn(
                      "group/row flex items-start gap-0.5 px-1 text-left transition-colors cursor-pointer overflow-hidden hover:bg-muted/50",
                      isSelected && "bg-muted",
                    )}
                  >
                    <div className="flex items-center w-full">
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(span.spanId);
                          }}
                          className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20"
                        >
                          <ChevronRight
                            className={cn(
                              "size-3 transition-transform",
                              !isCollapsed && "rotate-90",
                            )}
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        className={cn(
                          "flex h-7 w-full items-center gap-1 px-1 text-left transition-colors cursor-pointer overflow-hidden",
                        )}
                        style={{
                          paddingLeft: `${(span.depth + (hasChildren ? 0 : 1)) * 16}px`,
                        }}
                        onClick={() => toggleSelection(span.spanId)}
                      >
                        <ConclusionIcon
                          conclusion={span.conclusion}
                          className="size-3 shrink-0"
                        />
                        <FrameworkIcon
                          framework={span.testFramework}
                          className="size-3 shrink-0"
                        />
                        <span className="truncate text-xs font-medium">
                          {span.name}
                        </span>
                        {span.testName &&
                          flakySet.size > 0 &&
                          (flakySet.has(span.testName) ||
                            flakySet.has(span.name)) && (
                            <span className="shrink-0 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                              Flaky
                            </span>
                          )}
                      </button>
                      <button
                        type="button"
                        title="Focus on this span"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedSpanId(span.spanId);
                        }}
                        className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-muted-foreground/20"
                      >
                        <Focus className="size-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        height: detailHeight,
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel — timeline */}
        <ResizablePanel defaultSize="80%" minSize="20%" maxSize="90%">
          <div
            ref={rightScrollRef}
            className="h-full overflow-y-auto overflow-x-hidden pr-1"
            onScroll={() => syncScroll("right")}
          >
            {/* Time axis */}
            <div className="sticky top-0 z-10 h-5 bg-card border-b border-border text-xs text-muted-foreground">
              {markers.map((marker, index) => (
                <span
                  key={marker.fraction}
                  className={cn(
                    "absolute whitespace-nowrap",
                    index === markers.length - 1 && "-translate-x-full",
                  )}
                  style={{ left: `${marker.fraction * 100}%` }}
                >
                  {marker.label}
                </span>
              ))}
            </div>

            {/* Span rows + grid lines */}
            <div className="relative">
              {/* Continuous grid lines background */}
              <div className="absolute inset-y-0 left-0 right-0 pointer-events-none">
                {markers.slice(1, -1).map((marker) => (
                  <div
                    key={marker.fraction}
                    className="absolute top-0 h-full w-px bg-border/50"
                    style={{ left: `${marker.fraction * 100}%` }}
                  />
                ))}
              </div>

              {filteredSpans.map((span) => {
                const rawLeft =
                  ((span.startTime - minTime) / totalDuration) * 100;
                const rawRight =
                  ((span.endTime - minTime) / totalDuration) * 100;
                const leftPercent = Math.max(0, rawLeft);
                const rightPercent = Math.min(100, rawRight);
                const widthPercent = Math.max(0, rightPercent - leftPercent);
                const isSelected = selectedSpanId === span.spanId;

                return (
                  <Fragment key={span.spanId}>
                    {/* Timeline row */}
                    <button
                      type="button"
                      className={cn(
                        "relative flex h-7 w-full items-center text-left transition-colors cursor-pointer",
                        "hover:bg-muted/50",
                        isSelected && "bg-muted",
                      )}
                      onClick={() => toggleSelection(span.spanId)}
                    >
                      {/* Duration bar */}
                      <div
                        className="absolute top-1 bottom-1 rounded-xs"
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          minWidth: 4,
                          maxWidth: `${100 - leftPercent}%`,
                          backgroundColor: stringToColor(span.name),
                        }}
                      />

                      {/* Duration label */}
                      {leftPercent + widthPercent > 85 ? (
                        <span
                          className="absolute top-1 text-[10px] font-medium text-foreground/80"
                          style={{
                            right: `${100 - leftPercent + 1}%`,
                          }}
                        >
                          {formatDuration(span.duration, "ms")}
                        </span>
                      ) : (
                        <span
                          className="absolute top-1 text-[10px] font-medium text-foreground/80"
                          style={{
                            left: `${leftPercent + widthPercent + 1}%`,
                          }}
                        >
                          {formatDuration(span.duration, "ms")}
                        </span>
                      )}
                    </button>

                    {/* Inline detail panel */}
                    {isSelected && (
                      <div ref={detailRef}>
                        <SpanDetailPanel
                          span={span}
                          minTime={minTime}
                          traceId={traceId}
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
