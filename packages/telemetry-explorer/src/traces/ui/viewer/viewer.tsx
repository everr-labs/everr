import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@everr/ui/components/resizable";
import { RetryError } from "@everr/ui/components/retry-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatDuration } from "@everr/ui/lib/formatting";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { getTraceOptions } from "../../data/options";
import type { TracesRepositoryLike } from "../../data/repository";
import type { Span } from "../../data/types";
import { computeDetailWindow } from "../../data/window";
import { serviceColor } from "../shared/service-color";
import {
  type FlamegraphHandle,
  TraceFlamegraph,
  type ViewRange,
} from "./flamegraph";
import {
  matchesSpan,
  SPAN_CATEGORIES,
  type SpanCategory,
  type TraceModel,
} from "./model";
import { prepareTraceLayout, prepareTraceModel } from "./processor";
import { spanColorGroup } from "./rendering/types";
import {
  getAncestorSpanIds,
  getVisibleSpans,
} from "./rendering/waterfall-utils";
import { SpanDetails } from "./span-details";
import { TraceWaterfall } from "./waterfall";

export type TraceExplorerProps = {
  repo: TracesRepositoryLike;
  traceId: string;
  search: {
    span?: string;
    start?: string;
    end?: string;
    from?: string;
    to?: string;
    refresh?: string;
  };
  onBack: () => void;
  onSpanChange: (spanId: string | undefined) => void;
};

type Props = Omit<TraceExplorerProps, "repo">;

export function TraceExplorer(props: TraceExplorerProps) {
  const window = computeDetailWindow({
    start: props.search.start,
    end: props.search.end,
    timeRange: { from: props.search.from, to: props.search.to },
  });
  const { data, dataUpdatedAt, isPending, error, refetch } = useQuery(
    getTraceOptions({
      repo: props.repo,
      traceId: props.traceId,
      window,
      refresh: props.search.refresh ?? "off",
    }),
  );
  if (isPending)
    return (
      <div className="p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-4 h-96 w-full" />
      </div>
    );
  if (error)
    return (
      <RetryError
        title="Failed to load trace"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!data?.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <h1 className="font-medium">Trace not found</h1>
        <p className="text-muted-foreground text-sm">
          No spans matched this trace in the selected time window.
        </p>
        <Button variant="outline" onClick={props.onBack}>
          Back to traces
        </Button>
      </div>
    );
  return (
    <PreparedTraceViewer
      key={`${props.traceId}:${window.fromTs}:${window.toTs}`}
      {...props}
      spans={data}
      version={dataUpdatedAt}
      queryKey={["traces", "viewer", props.traceId, window.fromTs, window.toTs]}
    />
  );
}

function PreparedTraceViewer({
  spans,
  version,
  queryKey,
  ...props
}: Props & { spans: Span[]; version: number; queryKey: string[] }) {
  const { data, error, refetch } = useQuery({
    queryKey: [...queryKey, "model", version],
    queryFn: async ({ signal }) => ({
      model: await prepareTraceModel(spans, signal),
      version,
    }),
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });
  if (error)
    return (
      <RetryError
        title="Failed to prepare trace"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!data)
    return <Skeleton className="m-4 h-96" aria-label="Preparing trace" />;
  return (
    <TraceViewer
      {...props}
      model={data.model}
      layoutKey={[...queryKey, "layout", data.version]}
    />
  );
}

function PreparedFlamegraph({
  model,
  queryKey,
  ...props
}: Omit<ComponentProps<typeof TraceFlamegraph>, "layout"> & {
  queryKey: (string | number)[];
}) {
  const { data, error, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => prepareTraceLayout(model.waterfall, signal),
    staleTime: Infinity,
    retry: false,
  });
  if (error)
    return (
      <RetryError
        title="Failed to prepare flamegraph"
        message={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!data)
    return (
      <Skeleton className="m-4 h-full" aria-label="Preparing flamegraph" />
    );
  return <TraceFlamegraph {...props} model={model} layout={data} />;
}

function TraceViewer({
  model,
  layoutKey,
  traceId,
  search,
  onSpanChange,
  onBack,
}: Props & { model: TraceModel; layoutKey: (string | number)[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SpanCategory>("All");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [colorBy, setColorBy] = useState<string | null>("service.name");
  const [previewField, setPreviewField] = useState<string | null>("");
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set<string>());
  const openNodes = useMemo(
    () =>
      new Set(
        model.waterfall
          .filter((s) => s.hasChildren && !collapsedNodes.has(s.spanId))
          .map((s) => s.spanId),
      ),
    [model, collapsedNodes],
  );
  const [flamegraphOpen, setFlamegraphOpen] = useState(false);
  const [zoomRange, setZoomRange] = useState<ViewRange | null>(null);
  const range = zoomRange ?? { start: 0, end: model.durationMs };
  const flamegraphRef = useRef<FlamegraphHandle>(null);
  const waterfallRef = useRef<VirtuosoHandle>(null);
  const selectedId = search.span;
  const selected = selectedId ? model.byId.get(selectedId) : undefined;
  const filterActive = Boolean(
    query.trim() || category !== "All" || errorsOnly,
  );
  const matches = useMemo(
    () =>
      model.waterfall.filter((node) =>
        matchesSpan(node, query, category, errorsOnly),
      ),
    [model, query, category, errorsOnly],
  );
  const matchingSet = useMemo(
    () => new Set(matches.map((span) => span.spanId)),
    [matches],
  );
  const visibleRows = useMemo(
    () => getVisibleSpans(model.waterfall, openNodes),
    [model, openNodes],
  );
  const root = model.roots[0];
  const previewFields = useMemo(
    () =>
      [
        ...new Set(
          model.waterfall.flatMap((node) => Object.keys(node.attributes)),
        ),
      ].sort(),
    [model],
  );
  const services = useMemo(
    () => [...new Set(model.waterfall.map((s) => s.source.serviceName))],
    [model],
  );
  const colorGroups = useMemo(
    () => [
      ...new Set(
        model.waterfall.map((node) =>
          spanColorGroup(node, colorBy ?? "service.name"),
        ),
      ),
    ],
    [model, colorBy],
  );

  const selectSpan = useCallback(
    (id: string) => {
      const ancestors = getAncestorSpanIds(model.waterfall, id);
      const expanded = new Set([...openNodes, ...ancestors]);
      setCollapsedNodes((prev) => {
        const next = new Set(prev);
        for (const ancestor of ancestors) next.delete(ancestor);
        return next;
      });
      onSpanChange(id);
      flamegraphRef.current?.scrollToSpan(id);
      const rows = getVisibleSpans(model.waterfall, expanded);
      const index = rows.findIndex((s) => s.spanId === id);
      requestAnimationFrame(() => {
        if (index >= 0)
          waterfallRef.current?.scrollToIndex({ index, align: "center" });
      });
    },
    [model, openNodes, onSpanChange],
  );

  const navigateMatch = (direction: number) => {
    if (!matches.length) return;
    const current = matches.findIndex((s) => s.spanId === selectedId);
    const index =
      current < 0
        ? direction > 0
          ? 0
          : matches.length - 1
        : (current + direction + matches.length) % matches.length;
    selectSpan(matches[index].spanId);
  };
  const zoom = (factor: number) => {
    const width = Math.min(
      model.durationMs,
      Math.max(
        Math.min(model.durationMs, 0.001),
        (range.end - range.start) * factor,
      ),
    );
    const start = Math.max(
      0,
      Math.min(model.durationMs - width, (range.start + range.end - width) / 2),
    );
    setZoomRange({ start, end: start + width });
  };

  return (
    <section
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      aria-label="Trace explorer detail"
    >
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to traces"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">
            {root?.name ?? "Trace"}
          </h1>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{root?.source.serviceName}</span>
            <span className="font-mono">
              {formatDuration(model.durationMs, "ms")}
            </span>
            <span>{model.waterfall.length} spans</span>
            <span>{services.length} services</span>
            {model.errorCount > 0 && (
              <span className="text-destructive">
                {model.errorCount} errors
              </span>
            )}
            <span className="truncate font-mono text-[10px]" title={traceId}>
              {traceId}
            </span>
          </div>
        </div>
      </div>
      {model.missingParents > 0 && (
        <div className="shrink-0 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {model.missingParents} spans have parents outside the loaded trace.
          They appear as separate roots.
        </div>
      )}
      {search.span && !selected && (
        <div className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
          The linked span is not present in the loaded trace.
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-48 max-w-md flex-1">
          <Search className="text-muted-foreground absolute left-2 top-2 size-4" />
          <Input
            aria-label="Search spans"
            placeholder="Search spans, services or attributes"
            className="pl-8 pr-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1"
              aria-label="Clear span search"
              onClick={() => setQuery("")}
            >
              <X />
            </Button>
          )}
        </div>
        <div
          className="text-muted-foreground min-w-16 text-center text-xs"
          aria-live="polite"
        >
          {matches.length} matches
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous matching span"
          disabled={!matches.length}
          onClick={() => navigateMatch(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next matching span"
          disabled={!matches.length}
          onClick={() => navigateMatch(1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant={errorsOnly ? "secondary" : "outline"}
          size="sm"
          aria-pressed={errorsOnly}
          onClick={() => setErrorsOnly((prev) => !prev)}
        >
          Highlight errors
        </Button>
        <fieldset className="flex gap-1" aria-label="Span categories">
          {SPAN_CATEGORIES.map((item) => (
            <Button
              key={item}
              variant={category === item ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </Button>
          ))}
        </fieldset>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs">Color by</span>
        <Select value={colorBy} onValueChange={setColorBy}>
          <SelectTrigger size="sm" aria-label="Color spans by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["service.name", "service.namespace", "host.name"].map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-2 text-xs">Preview</span>
        <Select value={previewField} onValueChange={setPreviewField}>
          <SelectTrigger
            size="sm"
            aria-label="Preview span attribute"
            className="max-w-56"
          >
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None</SelectItem>
            {previewFields.map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Expand all spans"
            onClick={() => setCollapsedNodes(new Set())}
          >
            <ChevronsUpDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Collapse all spans"
            onClick={() =>
              setCollapsedNodes(
                new Set(
                  model.waterfall
                    .filter((s) => s.hasChildren)
                    .map((s) => s.spanId),
                ),
              )
            }
          >
            <ChevronsDownUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in"
            onClick={() => zoom(0.5)}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out"
            onClick={() => zoom(2)}
          >
            <ZoomOut />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoomRange(null)}>
            Reset zoom
          </Button>
        </div>
      </div>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="72%" minSize="35%">
          <div className="flex h-full min-h-0 flex-col">
            <button
              type="button"
              className="flex h-8 shrink-0 items-center gap-2 border-b px-4 text-xs font-medium hover:bg-muted/40"
              aria-expanded={flamegraphOpen}
              onClick={() => setFlamegraphOpen((prev) => !prev)}
            >
              {flamegraphOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Flamegraph
              <span className="text-muted-foreground ml-auto text-[10px] font-normal">
                Pinch to zoom · drag to pan
              </span>
            </button>
            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
            >
              {flamegraphOpen && (
                <>
                  <ResizablePanel defaultSize="35%" minSize="15%">
                    <PreparedFlamegraph
                      queryKey={layoutKey}
                      ref={flamegraphRef}
                      model={model}
                      selectedSpanId={selectedId}
                      matchingIds={matchingSet}
                      filterActive={filterActive}
                      colorBy={colorBy ?? "service.name"}
                      range={range}
                      onRangeChange={setZoomRange}
                      onSelect={selectSpan}
                    />
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle
                    aria-label="Resize flamegraph and waterfall"
                  />
                </>
              )}
              <ResizablePanel minSize="20%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="h-8 shrink-0 border-b px-4 pt-2 text-xs font-medium">
                    Waterfall
                  </div>
                  <TraceWaterfall
                    rows={visibleRows}
                    selectedSpanId={selectedId}
                    openNodes={openNodes}
                    matchingIds={matchingSet}
                    filterActive={filterActive}
                    colorBy={colorBy ?? "service.name"}
                    previewField={previewField ?? ""}
                    range={range}
                    virtuosoRef={waterfallRef}
                    onSelect={selectSpan}
                    onToggle={(id) =>
                      setCollapsedNodes((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
              {colorGroups.map((group) => (
                <span key={group} className="flex items-center gap-1">
                  <span
                    className="size-2 rounded-sm"
                    style={{
                      backgroundColor: serviceColor(group),
                    }}
                  />
                  {group}
                </span>
              ))}
            </div>
          </div>
        </ResizablePanel>
        {selected && (
          <>
            <ResizableHandle withHandle aria-label="Resize span details" />
            <ResizablePanel defaultSize="28%" minSize="20%">
              <SpanDetails
                key={selected.spanId}
                node={selected}
                durationMs={model.durationMs}
                start={search.start ?? root?.source.timestamp ?? ""}
                end={search.end ?? ""}
                onClose={() => onSpanChange(undefined)}
                onFocus={() => {
                  const padding = Math.max(
                    (selected.durationNano / 1e6) * 0.1,
                    0.001,
                  );
                  setZoomRange({
                    start: Math.max(0, selected.timestamp - padding),
                    end: Math.min(
                      model.durationMs,
                      selected.timestamp +
                        selected.durationNano / 1e6 +
                        padding,
                    ),
                  });
                  flamegraphRef.current?.scrollToSpan(selected.spanId);
                }}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </section>
  );
}
