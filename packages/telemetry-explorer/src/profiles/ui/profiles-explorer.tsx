import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { Layers, ZoomOut } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { withEnvironment } from "../../filters/environment";
import { countPersistentFilters } from "../../filters/ui/explore-global-filters";
import { TraceFlamegraph, type ViewRange } from "../../traces/ui/viewer/flamegraph";
import type { FlamegraphSpan } from "../../traces/ui/viewer/rendering/types";
import {
  profileExampleTracesOptions,
  profileHistogramOptions,
  profileSampleTypesOptions,
  profileStacksOptions,
  profileVersionsOptions,
} from "../data/options";
import type { ProfilesRepositoryLike } from "../data/repository";
import type { RuntimeMetricsRepositoryLike } from "../data/runtime";
import type { ProfileFilterInput } from "../data/schemas";
import type { ProfileStacks, SampleTypeOption } from "../data/types";
import { FRAME_COLOR_KEY, frameId, frameRange, profileFlamegraph } from "../model/flame-layout";
import {
  buildFlameTree,
  type FlameNode,
  findNodeByPath,
  frameKey,
  functionStats,
  nodePath,
  stacksUnder,
} from "../model/flame-tree";
import { formatPercent, formatProfileValue } from "../model/format";
import { buildSandwich, type FunctionRef } from "../model/sandwich";
import { pickSampleType } from "../model/selection";
import { sourceLink } from "../model/source-link";
import {
  type ProfileVersion,
  pickVersions,
  VERSION_LOOKBACK_DAYS,
  versionLookupRange,
  versionWindow,
} from "../model/versions";
import {
  type Baseline,
  baselineRange,
  diffColor,
  diffFlameTrees,
  diffFunctionStats,
  type FrameDiff,
  formatShareDelta,
  isPresetBaseline,
  maxAbsDelta,
} from "../model/diff";
import { CompareMenu, CompareStatus, formatWindow, VersionMenu } from "./compare-controls";
import {
  CLEARED_PROFILE_FILTERS,
  countProfileFilters,
  type ProfileFilterPatch,
  ProfileFilters,
  sampleTypeLabel,
} from "./profile-filters";
import { ProfileHistogram } from "./profile-histogram";
import {
  type ExampleTracesState,
  FunctionPanel,
  type RenderProfileTraceLink,
  SandwichView,
} from "./sandwich-view";
import { RuntimeStrip } from "./runtime-strip";
import { FrameMenuItems, PinnedFunction, useFunctionHighlight } from "./function-highlight";
import { DiffFunctionsTable, TopFunctionsTable } from "./top-functions-table";

export type ProfilesExplorerSearch = {
  /** The shared Explore Service filter; empty means every service. */
  service: string[];
  q: string;
  sampleType?: string;
  sampleUnit?: string;
  traceId?: string;
  spanId?: string;
  attributes: AttributeFilter[];
  showVolume: boolean;
  compare?: Baseline;
  /** The `custom` baseline window, ISO timestamps. */
  baseFrom?: string;
  baseTo?: string;
  /** The `version` comparison's `service.version` values. */
  version?: string;
  baseVersion?: string;
  /** The function the callers and callees view centers on. */
  fn?: FunctionRef;
};

export type ProfilesExplorerPatch = Partial<Omit<ProfilesExplorerSearch, "service">>;

export type ProfilesExplorerProps = {
  repo: ProfilesRepositoryLike;
  /** Node.js runtime metrics shown under the histogram; omit to hide them. */
  runtimeRepo?: RuntimeMetricsRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  search: ProfilesExplorerSearch;
  environment?: string[];
  // The top zone of the rail: Service and Environment, shared with the other
  // Explore pages, so the host app supplies it.
  persistentFilters?: ReactNode;
  onSearchChange: (patch: ProfilesExplorerPatch) => void;
  onTimeRangeSelect?: (from: Date, to: Date) => void;
  /** Links an example trace to the host's trace page; without it the traces are plain text. */
  renderTraceLink?: RenderProfileTraceLink;
};

export function ProfilesExplorer({
  repo,
  runtimeRepo,
  timeRange,
  refresh,
  search,
  environment = [],
  persistentFilters,
  onSearchChange,
  onTimeRangeSelect,
  renderTraceLink,
}: ProfilesExplorerProps) {
  // Every filter but the version, which a version comparison adds.
  const pageFilters: ProfileFilterInput = useMemo(
    () => ({
      timeRange,
      services: search.service,
      traceId: search.traceId,
      spanId: search.spanId,
      q: search.q,
      attributes: withEnvironment(search.attributes, environment),
    }),
    [
      timeRange,
      search.service,
      search.traceId,
      search.spanId,
      search.q,
      search.attributes,
      environment,
    ],
  );

  const comparingVersions = search.compare === "version";
  const versionLookupFilters = useMemo(
    () => ({ ...pageFilters, timeRange: versionLookupRange(pageFilters.timeRange) }),
    [pageFilters],
  );
  const versionsQuery = useQuery(
    profileVersionsOptions({
      repo,
      refresh,
      filters: versionLookupFilters,
      enabled: comparingVersions,
    }),
  );
  const versions = comparingVersions ? (versionsQuery.data ?? []) : [];
  const versionPair = pickVersions(versions, search);
  const comparisonVersion = versionPair.comparison?.version;
  const filters: ProfileFilterInput = useMemo(
    () => (comparisonVersion ? { ...pageFilters, versions: [comparisonVersion] } : pageFilters),
    [pageFilters, comparisonVersion],
  );

  const sampleTypesQuery = useQuery(
    profileSampleTypesOptions({ repo, refresh, filters: pageFilters }),
  );
  const sampleTypes = sampleTypesQuery.data ?? [];
  const sampleType = pickSampleType(sampleTypes, search);

  const stacksQuery = useQuery(
    profileStacksOptions({
      repo,
      refresh,
      filters,
      sampleType: sampleType?.sampleType,
      sampleUnit: sampleType?.sampleUnit,
    }),
  );
  const baselineVersion = versionPair.baseline;
  const comparison = useMemo(
    () =>
      search.compare
        ? resolveComparison({
            compare: search.compare,
            filters,
            pageFilters,
            baseFrom: search.baseFrom,
            baseTo: search.baseTo,
            comparisonVersion,
            baselineVersion,
            versionsPending: versionsQuery.isPending,
            versionsError: versionsQuery.isError,
          })
        : undefined,
    [
      search.compare,
      search.baseFrom,
      search.baseTo,
      filters,
      pageFilters,
      comparisonVersion,
      baselineVersion,
      versionsQuery.isPending,
      versionsQuery.isError,
    ],
  );
  const baselineFilters = comparison?.filters;
  const baselineQuery = useQuery(
    profileStacksOptions({
      repo,
      refresh,
      filters: baselineFilters ?? filters,
      sampleType: sampleType?.sampleType,
      sampleUnit: sampleType?.sampleUnit,
      enabled: baselineFilters !== undefined,
    }),
  );
  const histogramQuery = useQuery(
    profileHistogramOptions({
      repo,
      refresh,
      filters,
      sampleType: sampleType?.sampleType,
      sampleUnit: sampleType?.sampleUnit,
      enabled: search.showVolume,
    }),
  );
  const exampleTracesQuery = useQuery(
    profileExampleTracesOptions({
      repo,
      refresh,
      filters,
      sampleType: sampleType?.sampleType,
      sampleUnit: sampleType?.sampleUnit,
      functionName: search.fn?.name,
    }),
  );

  // Zoom is a path of frame keys, so it survives refetches of the same stacks
  // and falls back to the nearest frame that still exists.
  const [zoomPath, setZoomPath] = useState<string[]>([]);

  const changeFilters = (patch: ProfileFilterPatch) => {
    setZoomPath([]);
    onSearchChange(patch);
  };

  let content: ReactNode;
  if (sampleTypesQuery.isPending) {
    content = <LoadingState />;
  } else if (sampleTypesQuery.isError || stacksQuery.isError) {
    const error = sampleTypesQuery.error ?? stacksQuery.error;
    content = (
      <RetryError
        title="Could not load the profile"
        message={error?.message ?? "Unknown error"}
        onRetry={() => {
          void sampleTypesQuery.refetch();
          void stacksQuery.refetch();
        }}
      />
    );
  } else if (!sampleType) {
    content = <NoProfiles />;
  } else if (stacksQuery.isPending) {
    content = <LoadingState />;
  } else if (stacksQuery.data.stacks.length === 0) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matching samples</EmptyTitle>
          <EmptyDescription>
            No {sampleTypeLabel(sampleType)} samples match these filters in this time range.
          </EmptyDescription>
        </EmptyHeader>
        {countProfileFilters(search) > 0 ? (
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => changeFilters(CLEARED_PROFILE_FILTERS)}
            >
              Clear page filters
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  } else {
    content = (
      <ProfileView
        key={`${sampleType.sampleType}\u0000${sampleType.sampleUnit}`}
        data={stacksQuery.data}
        sampleType={sampleType}
        compareBar={
          <>
            <CompareMenu
              value={search.compare}
              onChange={(compare) =>
                onSearchChange({
                  compare,
                  baseFrom: undefined,
                  baseTo: undefined,
                  version: undefined,
                  baseVersion: undefined,
                })
              }
            />
            {comparingVersions && versions.length > 0 ? (
              <>
                <VersionMenu
                  label="Version"
                  versions={versions}
                  value={comparisonVersion}
                  exclude={baselineVersion?.version}
                  onChange={(version) => onSearchChange({ version })}
                />
                <VersionMenu
                  label="Baseline"
                  versions={versions}
                  value={baselineVersion?.version}
                  exclude={comparisonVersion}
                  onChange={(baseVersion) => onSearchChange({ baseVersion })}
                />
              </>
            ) : null}
            {comparison ? (
              <CompareStatus
                description={comparison.description}
                missing={comparison.missing}
                baseline={baselineQuery.data}
                error={baselineQuery.isError}
                unit={displayUnit(sampleType)}
              />
            ) : null}
          </>
        }
        baseline={baselineFilters ? baselineQuery.data : undefined}
        zoomPath={zoomPath}
        onZoom={setZoomPath}
        fn={search.fn}
        onFunctionSelect={(fn) => onSearchChange({ fn })}
        exampleTraces={{
          data: exampleTracesQuery.data,
          isPending: exampleTracesQuery.isPending,
          isError: exampleTracesQuery.isError,
        }}
        renderTraceLink={renderTraceLink}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ProfileFilters
            repo={repo}
            timeRange={timeRange}
            value={{
              q: search.q,
              sampleType: search.sampleType,
              sampleUnit: search.sampleUnit,
              traceId: search.traceId,
              spanId: search.spanId,
              attributes: search.attributes,
            }}
            sampleTypes={sampleTypes}
            sampleType={sampleType}
            persistentFilters={persistentFilters}
            persistentFilterCount={countPersistentFilters(search.service, environment)}
            onChange={changeFilters}
          />
          <main className="flex min-h-0 min-w-0 flex-col">
            {sampleType ? (
              <ProfileHistogram
                buckets={histogramQuery.data ?? []}
                sampleType={sampleType}
                isPending={histogramQuery.isPending}
                showVolume={search.showVolume}
                selectingBaseline={search.compare === "custom"}
                baseline={
                  search.compare === "custom" && search.baseFrom && search.baseTo
                    ? { from: new Date(search.baseFrom), to: new Date(search.baseTo) }
                    : undefined
                }
                onRangeSelect={(from, to) => {
                  if (search.compare === "custom") {
                    onSearchChange({ baseFrom: from.toISOString(), baseTo: to.toISOString() });
                    return;
                  }
                  setZoomPath([]);
                  onTimeRangeSelect?.(from, to);
                }}
                onShowVolumeChange={(showVolume) => onSearchChange({ showVolume })}
              />
            ) : null}
            {sampleType && runtimeRepo && search.showVolume ? (
              <RuntimeStrip
                repo={runtimeRepo}
                refresh={refresh}
                filters={filters}
                onRangeSelect={(from, to) => {
                  setZoomPath([]);
                  onTimeRangeSelect?.(from, to);
                }}
              />
            ) : null}
            {content}
          </main>
        </div>
      </section>
    </div>
  );
}

function ProfileView({
  data,
  sampleType,
  compareBar,
  baseline,
  zoomPath,
  onZoom,
  fn,
  onFunctionSelect,
  exampleTraces,
  renderTraceLink,
}: {
  data: ProfileStacks;
  sampleType: SampleTypeOption;
  /** The comparison controls and status, for the toolbar. */
  compareBar: ReactNode;
  /** The baseline window's stacks; absent while loading or when not comparing. */
  baseline: ProfileStacks | undefined;
  zoomPath: string[];
  onZoom: (path: string[]) => void;
  /** Set to show that function's callers and callees instead of the whole profile. */
  fn: FunctionRef | undefined;
  onFunctionSelect: (fn: FunctionRef | undefined) => void;
  exampleTraces: ExampleTracesState;
  renderTraceLink: RenderProfileTraceLink | undefined;
}) {
  const tree = useMemo(() => buildFlameTree(data.stacks), [data.stacks]);
  const flamegraph = useMemo(() => profileFlamegraph(tree), [tree]);
  const stats = useMemo(() => functionStats(data.stacks), [data.stacks]);
  const statsByKey = useMemo(() => new Map(stats.map((stat) => [stat.key, stat])), [stats]);
  const highlight = useFunctionHighlight(flamegraph.nodes);
  const baselineTree = useMemo(
    () => (baseline ? buildFlameTree(baseline.stacks) : undefined),
    [baseline],
  );
  const diffs = useMemo(
    () => (baselineTree ? diffFlameTrees(tree, baselineTree) : undefined),
    [tree, baselineTree],
  );
  const colorOf = useMemo(() => {
    if (!diffs) return undefined;
    const scale = maxAbsDelta(diffs);
    return (span: FlamegraphSpan) => {
      const diff = diffs.get(span.spanId);
      return diff ? diffColor(diff.delta, scale) : undefined;
    };
  }, [diffs]);
  const sandwich = useMemo(() => (fn ? buildSandwich(data.stacks, fn) : undefined), [data, fn]);
  const baselineSandwich = useMemo(
    () => (fn && baseline ? buildSandwich(baseline.stacks, fn) : undefined),
    [baseline, fn],
  );
  const focus = findNodeByPath(tree.root, zoomPath);
  // Zoomed into a frame, the table lists only the functions under it, as
  // shares of it, to match what the flame graph shows.
  const tablePath = useMemo(() => (fn || !focus.parent ? undefined : nodePath(focus)), [fn, focus]);
  const tableStats = useMemo(
    () => (tablePath ? functionStats(stacksUnder(data.stacks, tablePath)) : stats),
    [data.stacks, stats, tablePath],
  );
  const tableTotal = tablePath ? focus.total : tree.root.total;
  const functionDiffs = useMemo(() => {
    if (!baseline || !baselineTree) return undefined;
    const baselineStacks = tablePath ? stacksUnder(baseline.stacks, tablePath) : baseline.stacks;
    const baselineTotal = tablePath
      ? baselineStacks.reduce((sum, stack) => sum + stack.value, 0)
      : baselineTree.root.total;
    return {
      rows: diffFunctionStats(tableStats, tableTotal, functionStats(baselineStacks), baselineTotal),
      baselineTotal,
    };
  }, [baseline, baselineTree, tableStats, tableTotal, tablePath]);
  // Wheel zoom and drag pan move the view off the zoomed frame until the next click.
  const [pannedRange, setPannedRange] = useState<ViewRange | null>(null);
  const range = pannedRange ?? frameRange(focus);
  const unit = displayUnit(sampleType);
  const total = tree.root.total;
  const truncated = data.stackCount > data.stacks.length;
  const zoomed = focus.parent !== undefined || pannedRange !== null;
  const fnKey = fn ? frameKey({ ...fn, line: 0 }) : undefined;

  const sourceUrlOf = (key: string) => {
    const stat = statsByKey.get(key);
    if (!stat) return undefined;
    const source = stat.source === undefined ? undefined : data.sources?.[stat.source];
    return sourceLink(source, stat.file, stat.line);
  };

  const zoomTo = (path: string[]) => {
    setPannedRange(null);
    onZoom(path);
  };

  // In callers and callees a row recenters the view; otherwise it highlights
  // the function's frames in the flame graph.
  const tableActions = fn
    ? {
        activeKey: fnKey,
        activateHint: "Show callers and callees",
        onActivate: onFunctionSelect,
        onHover: () => {},
        onShowCallers: onFunctionSelect,
        sourceUrlOf,
      }
    : {
        ...highlight.table,
        activateHint: "Highlight in the flame graph",
        onActivate: highlight.togglePin,
        onShowCallers: onFunctionSelect,
        sourceUrlOf,
      };

  const renderFrameHover = (node: FlameNode, diff: FrameDiff | undefined) => (
    <>
      <FrameDetails node={node} unit={unit} total={total} />
      {diff && baselineTree ? (
        <FrameDiffDetails diff={diff} unit={unit} baselineTotal={baselineTree.root.total} />
      ) : null}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{sampleTypeLabel(sampleType)}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatProfileValue(total, unit)} in {data.stacks.length.toLocaleString("en-US")} stacks
        </span>
        {truncated ? (
          <span className="text-muted-foreground tabular-nums">
            Showing the {data.stacks.length.toLocaleString("en-US")} heaviest of{" "}
            {data.stackCount.toLocaleString("en-US")} stacks (
            {formatPercent(total, data.totalValue)} of the samples).
          </span>
        ) : null}
        {data.snapshots ? (
          <span className="text-muted-foreground tabular-nums">
            Average of {data.snapshots.toLocaleString("en-US")}{" "}
            {data.snapshots === 1 ? "snapshot" : "snapshots"}
          </span>
        ) : null}
        {compareBar}
        {fn ? null : (
          <span className="ml-auto flex min-w-0 items-center gap-2">
            {highlight.pinned ? (
              <PinnedFunction fn={highlight.pinned} onClear={highlight.clearPin} />
            ) : null}
            {focus.parent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFunctionSelect({ name: focus.name, file: focus.file })}
              >
                <Layers data-icon="inline-start" />
                Callers and callees
              </Button>
            ) : null}
            {zoomed ? (
              <Button variant="outline" size="sm" onClick={() => zoomTo([])}>
                <ZoomOut data-icon="inline-start" />
                Reset zoom
              </Button>
            ) : (
              <span className="text-muted-foreground">
                Click a frame to zoom in, right-click for more
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-[3] flex-col lg:flex-row">
        {fn && sandwich ? (
          <>
            <SandwichView
              key={fnKey}
              fn={fn}
              sandwich={sandwich}
              baseline={baselineSandwich}
              unit={unit}
              total={total}
              onSelect={onFunctionSelect}
              onBack={() => onFunctionSelect(undefined)}
              renderHover={renderFrameHover}
            />
            <FunctionPanel
              stat={fnKey ? statsByKey.get(fnKey) : undefined}
              fn={fn}
              unit={unit}
              total={total}
              sourceUrl={fnKey ? sourceUrlOf(fnKey) : undefined}
              exampleTraces={exampleTraces}
              renderTraceLink={renderTraceLink}
            />
          </>
        ) : (
          <div className="min-h-0 min-w-0 flex-1">
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
                    onShowCallers={() => onFunctionSelect({ name: node.name, file: node.file })}
                  />
                );
              }}
              formatValue={(value) => formatProfileValue(value, unit)}
              colorOf={colorOf}
              timeAxis={false}
              renderHover={(span) => {
                const node = flamegraph.nodes.get(span.spanId);
                return node ? renderFrameHover(node, diffs?.get(span.spanId)) : null;
              }}
              ariaLabel="Profile flame graph. Click a frame to zoom into it, pinch to zoom, drag to pan, double-click to reset."
            />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-[2] overflow-y-auto border-t">
        {tablePath ? (
          <p className="text-muted-foreground border-b px-3 py-1.5 text-xs">
            Functions under <span className="text-foreground font-mono">{focus.name}</span>, as
            shares of it
          </p>
        ) : null}
        {functionDiffs ? (
          <DiffFunctionsTable
            rows={functionDiffs.rows}
            unit={unit}
            total={tableTotal}
            baselineTotal={functionDiffs.baselineTotal}
            {...tableActions}
          />
        ) : (
          <TopFunctionsTable stats={tableStats} unit={unit} total={tableTotal} {...tableActions} />
        )}
      </div>
    </div>
  );
}

type Comparison = {
  /** The baseline's filters; absent while it cannot be queried, with the reason in `missing`. */
  filters: ProfileFilterInput | undefined;
  /** The two sides of the comparison, in words. */
  description: string;
  missing: string | undefined;
};

function resolveComparison({
  compare,
  filters,
  pageFilters,
  baseFrom,
  baseTo,
  comparisonVersion,
  baselineVersion,
  versionsPending,
  versionsError,
}: {
  compare: Baseline;
  filters: ProfileFilterInput;
  /** `filters` without the version a version comparison adds. */
  pageFilters: ProfileFilterInput;
  baseFrom: string | undefined;
  baseTo: string | undefined;
  comparisonVersion: string | undefined;
  baselineVersion: ProfileVersion | undefined;
  versionsPending: boolean;
  versionsError: boolean;
}): Comparison {
  const unavailable = (missing: string): Comparison => ({
    filters: undefined,
    description: "",
    missing,
  });
  if (isPresetBaseline(compare)) {
    const range = baselineRange(filters.timeRange, compare);
    return {
      filters: { ...filters, timeRange: range },
      description: `This range compared with ${formatWindow(range)}`,
      missing: undefined,
    };
  }
  if (compare === "custom") {
    if (!baseFrom || !baseTo) {
      return unavailable("Drag across the chart above to pick the baseline window");
    }
    const range = { from: baseFrom, to: baseTo };
    return {
      filters: { ...filters, timeRange: range },
      description: `This range compared with ${formatWindow(range)}`,
      missing: undefined,
    };
  }
  if (versionsError) return unavailable("Could not load the service versions");
  if (versionsPending) return unavailable("Loading versions…");
  if (!comparisonVersion) {
    return unavailable("No samples carry the service.version resource attribute");
  }
  if (!baselineVersion) {
    return unavailable(
      `No version before ${comparisonVersion} in the last ${VERSION_LOOKBACK_DAYS} days`,
    );
  }
  const { fromDate, toDate } = resolveTimeRange(filters.timeRange);
  const range = versionWindow(baselineVersion, toDate.getTime() - fromDate.getTime());
  return {
    filters: { ...pageFilters, versions: [baselineVersion.version], timeRange: range },
    description: `${comparisonVersion} in this range compared with ${baselineVersion.version} over the end of its samples, ${formatWindow(range)}`,
    missing: undefined,
  };
}

export function FrameDetails({
  node,
  unit,
  total,
}: {
  node: FlameNode;
  unit: string;
  total: number;
}) {
  const location = node.file ? (node.line > 0 ? `${node.file}:${node.line}` : node.file) : "";
  return (
    <>
      <div className="font-mono font-medium break-all">{node.name}</div>
      {location ? (
        <div className="text-muted-foreground mt-1 font-mono break-all">{location}</div>
      ) : null}
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">Total</dt>
        <dd>
          {formatProfileValue(node.total, unit)} ({formatPercent(node.total, total)})
        </dd>
        <dt className="text-muted-foreground">Self</dt>
        <dd>
          {formatProfileValue(node.self, unit)} ({formatPercent(node.self, total)})
        </dd>
      </dl>
    </>
  );
}

// `count` reads as samples, which suits CPU sample counts but not heap objects.
export function displayUnit(option: SampleTypeOption): string {
  return option.sampleType.endsWith("_objects") ? "objects" : option.sampleUnit;
}

function FrameDiffDetails({
  diff,
  unit,
  baselineTotal,
}: {
  diff: FrameDiff;
  unit: string;
  baselineTotal: number;
}) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t pt-1 tabular-nums">
      <dt className="text-muted-foreground">Baseline</dt>
      <dd>
        {formatProfileValue(diff.baseline, unit)} ({formatPercent(diff.baseline, baselineTotal)})
      </dd>
      <dt className="text-muted-foreground">Change</dt>
      <dd>{formatShareDelta(diff.delta)}</dd>
    </dl>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-1 p-3" aria-busy="true">
      {[100, 92, 80, 64, 40, 24].map((width) => (
        <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

function NoProfiles() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No profiles in this time range</EmptyTitle>
        <EmptyDescription>
          Profiles come from a continuous profiler that exports OTLP profiles, such as the
          OpenTelemetry eBPF profiler. Send them to the Everr collector, or widen the time range.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
