import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { TraceFlamegraph, type ViewRange } from "../../traces/ui/viewer/flamegraph";
import type { FlamegraphSpan } from "../../traces/ui/viewer/rendering/types";
import type { ProfileExampleTrace } from "../data/types";
import { diffColor, diffFlameTrees, type FrameDiff, maxAbsDelta } from "../model/diff";
import { FRAME_COLOR_KEY, frameRange, profileFlamegraph } from "../model/flame-layout";
import type { FlameNode, FlameTree, FunctionStat } from "../model/flame-tree";
import { formatPercent, formatProfileValue } from "../model/format";
import type { FunctionRef, Sandwich } from "../model/sandwich";

/** Renders a link to a trace, opened on one of its spans; the host owns its routes. */
export type RenderProfileTraceLink = (input: {
  traceId: string;
  spanId: string;
  className: string;
  children: ReactNode;
}) => ReactNode;

export type ExampleTracesState = {
  data: ProfileExampleTrace[] | undefined;
  isPending: boolean;
  isError: boolean;
};

const NO_MATCHES: ReadonlySet<string> = new Set();

/**
 * One function's callers above it and callees below it, both rooted at the
 * function. Clicking another frame moves the view to that function.
 */
export function SandwichView({
  fn,
  sandwich,
  baseline,
  unit,
  total,
  onSelect,
  onBack,
  renderHover,
}: {
  fn: FunctionRef;
  sandwich: Sandwich;
  /** The baseline window's sandwich, to color the change in share. */
  baseline: Sandwich | undefined;
  unit: string;
  total: number;
  onSelect: (fn: FunctionRef) => void;
  onBack: () => void;
  renderHover: (node: FlameNode, diff: FrameDiff | undefined) => ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Flame graph
        </Button>
        <span className="text-muted-foreground shrink-0">Callers and callees of</span>
        <span className="truncate font-mono font-medium" title={fn.name}>
          {fn.name}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
          {formatProfileValue(sandwich.callees.root.total, unit)} (
          {formatPercent(sandwich.callees.root.total, total)})
        </span>
      </div>
      {sandwich.callees.root.total === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-xs">
          No samples in this range ran this function. Pick another function below, or widen the time
          range.
        </p>
      ) : (
        <>
          <SandwichPane
            label="Callers"
            tree={sandwich.callers}
            baseline={baseline?.callers}
            inverted
            unit={unit}
            onSelect={onSelect}
            renderHover={renderHover}
          />
          <SandwichPane
            label="Callees"
            tree={sandwich.callees}
            baseline={baseline?.callees}
            inverted={false}
            unit={unit}
            onSelect={onSelect}
            renderHover={renderHover}
          />
        </>
      )}
    </div>
  );
}

function SandwichPane({
  label,
  tree,
  baseline,
  inverted,
  unit,
  onSelect,
  renderHover,
}: {
  label: string;
  tree: FlameTree;
  baseline: FlameTree | undefined;
  inverted: boolean;
  unit: string;
  onSelect: (fn: FunctionRef) => void;
  renderHover: (node: FlameNode, diff: FrameDiff | undefined) => ReactNode;
}) {
  const flamegraph = useMemo(() => profileFlamegraph(tree, { inverted }), [tree, inverted]);
  const diffs = useMemo(
    () => (baseline ? diffFlameTrees(tree, baseline) : undefined),
    [tree, baseline],
  );
  const colorOf = useMemo(() => {
    if (!diffs) return undefined;
    const scale = maxAbsDelta(diffs);
    return (span: FlamegraphSpan) => {
      const diff = diffs.get(span.spanId);
      return diff ? diffColor(diff.delta, scale) : undefined;
    };
  }, [diffs]);
  const [pannedRange, setPannedRange] = useState<ViewRange | null>(null);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-b" aria-label={label}>
      <h3 className="text-muted-foreground px-3 pt-1 text-[11px] font-medium tracking-wide uppercase">
        {label}
      </h3>
      {tree.maxDepth === 0 ? (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          {inverted ? "Only called at the root of its stacks." : "Calls no other functions."}
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <TraceFlamegraph
            model={flamegraph}
            layout={flamegraph.layout}
            matchingIds={NO_MATCHES}
            filterActive={false}
            colorBy={FRAME_COLOR_KEY}
            range={pannedRange ?? frameRange(tree.root)}
            onRangeChange={setPannedRange}
            onSelect={(id) => {
              const node = flamegraph.nodes.get(id);
              if (node?.parent) onSelect({ name: node.name, file: node.file });
            }}
            formatValue={(value) => formatProfileValue(value, unit)}
            colorOf={colorOf}
            timeAxis={false}
            renderHover={(span) => {
              const node = flamegraph.nodes.get(span.spanId);
              return node ? renderHover(node, diffs?.get(span.spanId)) : null;
            }}
            ariaLabel={`${label} of the function. Click a frame to show its callers and callees.`}
          />
        </div>
      )}
    </section>
  );
}

/** The selected function's totals, a link to its code, and traces whose samples ran it. */
export function FunctionPanel({
  stat,
  fn,
  unit,
  total,
  sourceUrl,
  exampleTraces,
  renderTraceLink,
}: {
  /** Absent when the function is not in the current stacks. */
  stat: FunctionStat | undefined;
  fn: FunctionRef;
  unit: string;
  total: number;
  sourceUrl: string | undefined;
  exampleTraces: ExampleTracesState;
  renderTraceLink: RenderProfileTraceLink | undefined;
}) {
  const line = stat?.line ?? 0;
  const location = fn.file ? (line > 0 ? `${fn.file}:${line}` : fn.file) : "";
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-t text-xs lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l">
      <div className="border-b px-3 py-2">
        <div className="font-mono font-medium break-all">{fn.name}</div>
        {location ? (
          <div className="text-muted-foreground mt-1 font-mono break-all">{location}</div>
        ) : null}
        {stat ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
            <dt className="text-muted-foreground">Total</dt>
            <dd>
              {formatProfileValue(stat.total, unit)} ({formatPercent(stat.total, total)})
            </dd>
            <dt className="text-muted-foreground">Self</dt>
            <dd>
              {formatProfileValue(stat.self, unit)} ({formatPercent(stat.self, total)})
            </dd>
          </dl>
        ) : (
          <p className="text-muted-foreground mt-2">Not in the samples of this range.</p>
        )}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary mt-2 inline-flex items-center gap-1 hover:underline"
          >
            <ExternalLink className="size-3" />
            Open source
          </a>
        ) : null}
      </div>
      <div className="px-3 py-2">
        <h3 className="font-medium">Traces that ran it</h3>
        <ExampleTraceList state={exampleTraces} unit={unit} renderTraceLink={renderTraceLink} />
      </div>
    </aside>
  );
}

function ExampleTraceList({
  state,
  unit,
  renderTraceLink,
}: {
  state: ExampleTracesState;
  unit: string;
  renderTraceLink: RenderProfileTraceLink | undefined;
}) {
  if (state.isPending) {
    return (
      <div className="mt-2 flex flex-col gap-1" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    );
  }
  if (state.isError) {
    return <p className="text-destructive mt-2">Could not load the traces.</p>;
  }
  const traces = state.data ?? [];
  if (traces.length === 0) {
    return (
      <p className="text-muted-foreground mt-2">
        No samples of this function carry a trace ID. Profilers link samples to the span that was
        active when they ran.
      </p>
    );
  }
  return (
    <ul className="mt-1 flex flex-col">
      {traces.map((trace) => {
        const label = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{trace.rootSpanName || trace.serviceName}</span>
              <span className="text-muted-foreground block truncate font-mono text-[11px]">
                {trace.traceId.slice(0, 16)} · span {trace.spanId}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatProfileValue(trace.value, unit)}</span>
          </>
        );
        const className =
          "hover:bg-muted/40 -mx-1 flex items-center gap-2 rounded-sm px-1 py-1 text-left";
        return (
          <li key={`${trace.traceId}:${trace.spanId}`}>
            {renderTraceLink ? (
              renderTraceLink({
                traceId: trace.traceId,
                spanId: trace.spanId,
                className,
                children: label,
              })
            ) : (
              <div className={className}>{label}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
