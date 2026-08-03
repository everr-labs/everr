import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CircleHelp, Gauge } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccFormatSloTarget,
  ccSloBurnPace,
  ccSloBurnPaceLabel,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type {
  CcRuleHealthStatus,
  CcSlo,
  CcSloGroupStatus,
} from "@/data/cc/types";
import { fromCcSlo } from "@/data/slos/mapping";
import { CcBudgetBar } from "./-components/budget-bar";
import {
  CcEmptyState,
  CcHealthHeart,
  CcPauseToggle,
  CcQueryError,
  CcRunbookLink,
  CcTableSkeleton,
  ccErrorMessage,
} from "./-components/shared";
import { useCcFreshBudgets } from "./-components/use-fresh-budgets";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/slos",
)({
  staticData: { breadcrumb: "SLOs" },
  head: () => ({ meta: [{ title: "Everr - Alerting SLOs" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchQuery(ccQueries.slos(deps.preview)),
  component: CcSlosPage,
});

// `worst` = the group with the least budget remaining; the row's headline.
type SloRow = {
  slo: CcSlo;
  statusPending: boolean;
  groups: CcSloGroupStatus[];
  worst: CcSloGroupStatus | null;
  /** Evaluator health, absent until the status snapshot resolves. */
  health?: CcRuleHealthStatus;
};

/** How many rows the listing shows per page (also the fresh-budget scan fan-out). */
const SLO_PAGE_SIZE = 10;

const TONE_URGENT = toneText({ tone: "danger", emphasis: "strong" });
const TONE_WARNING = toneText({ tone: "warning", emphasis: "strong" });
const TONE_ACTIVE = toneText({ tone: "live" });
const TONE_QUIET = toneText({ tone: "muted" });

// Pause/suppression outrank firing (neither evaluates or alerts). A firing
// row reports the tier's severity, never a delivery outcome: where an alert
// lands is the routing tree's business.
function rowStatus(row: SloRow): { label: string; tone: string } {
  if (row.slo.paused) return { label: "Paused", tone: TONE_QUIET };
  if (row.slo.spec.suppressed) {
    return { label: "Suppressed", tone: TONE_QUIET };
  }
  if (row.worst === null) return { label: "Not evaluated", tone: TONE_QUIET };

  const tiers = ccSloTiers(row.slo.spec);
  const severities = row.worst.firing_tiers.map((f) =>
    ccSloTierSeverity(tiers, { slo_tier: f.tier }),
  );
  if (severities.includes("critical")) {
    return { label: "Critical", tone: TONE_URGENT };
  }
  if (severities.length > 0) {
    return { label: "Warning", tone: TONE_WARNING };
  }

  // Firing is passed as empty: the firing cases already returned above.
  const burn = ccSloCurrentBurn(tiers, row.worst.tiers)?.effective ?? null;
  const pace = ccSloBurnPace(burn, []);
  return {
    label: ccSloBurnPaceLabel(pace),
    tone: pace === "draining" ? TONE_ACTIVE : TONE_QUIET,
  };
}

function SloPromiseCell({
  slo,
  health,
}: {
  slo: CcSlo;
  health?: CcRuleHealthStatus;
}) {
  const identity = ccSloIdentity(slo);
  const { label_columns } = slo.spec.sli;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Link
          to="/alerts/slos/$project/$slug"
          params={{ project: identity.project, slug: identity.slug }}
          // No truncate: `overflow:hidden` would let this flexible column
          // collapse to nothing when the viewport tightens.
          className="font-medium whitespace-nowrap text-foreground underline-offset-2 hover:underline"
        >
          {identity.name}
        </Link>
        <CcHealthHeart status={health} />
      </span>
      <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
        {ccFormatSloTarget(slo.spec.targetPercent)} over{" "}
        {ccSloWindowLabel(slo.spec)}
        {label_columns.length > 0 && (
          <>
            {" · by "}
            <span className="font-mono">{label_columns.join(", ")}</span>
          </>
        )}
      </span>
    </span>
  );
}

function SloRunbookCell({ slo }: { slo: CcSlo }) {
  const { runbookProject, runbookSlug } = fromCcSlo(slo);
  if (!runbookSlug) return null;
  return (
    <CcRunbookLink
      project={runbookProject ?? "default"}
      slug={runbookSlug}
      name={ccSloIdentity(slo).name}
    />
  );
}

function SloStatusCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-24" />;
  const { label, tone } = rowStatus(row);
  return <span className={`text-xs whitespace-nowrap ${tone}`}>{label}</span>;
}

function SloBudgetCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-36" />;
  return <CcBudgetBar remaining={row.worst?.budget_remaining ?? null} />;
}

// Shared readout: this cell, the detail hero, and the per-group table must
// always agree.
function SloExhaustionCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-16" />;
  const worst = row.worst;
  const readout = ccSloExhaustion(
    worst?.budget_remaining ?? null,
    worst?.time_to_exhaustion_secs ?? null,
    worst === null
      ? null
      : (ccSloCurrentBurn(ccSloTiers(row.slo.spec), worst.tiers)?.effective ??
          null),
  );
  return (
    <span
      className={`text-xs tabular-nums whitespace-nowrap ${
        readout.kind === "exhausted"
          ? TONE_URGENT
          : readout.kind === "forecast"
            ? TONE_ACTIVE
            : TONE_QUIET
      }`}
    >
      {readout.label}
    </span>
  );
}

function CcSlosPage() {
  const qc = useQueryClient();
  const { preview } = Route.useSearch();
  const previewName = preview?.trim() || undefined;
  const [pageIndex, setPageIndex] = useState(0);
  const slos = useQuery(ccQueries.slos(previewName));
  const slosData = slos.data ?? [];
  // One status query per SLO, cache-shared with the detail page.
  const statuses = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cc", "slos"] });

  const toggle = useMutation({
    mutationFn: (slo: CcSlo) =>
      slo.paused
        ? resumeCcSlo({ data: { sloId: slo.id } })
        : pauseCcSlo({ data: { sloId: slo.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const rows: SloRow[] = slosData
    .map((slo, i) => {
      const groups = statuses[i].data?.payload?.groups ?? [];
      return {
        slo,
        statusPending: statuses[i].isPending,
        groups,
        worst: ccWorstSloGroup(groups),
        health: statuses[i].data?.health.status,
      };
    })
    // Fixed name order, independent of status: the list must never reshuffle
    // as snapshots resolve or budgets recompute.
    .sort((a, b) => a.slo.name.localeCompare(b.slo.name));

  // Only the visible page runs the (expensive) read-time budget scan.
  const pageCount = Math.max(1, Math.ceil(rows.length / SLO_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageStart = page * SLO_PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + SLO_PAGE_SIZE);

  const freshBudgets = useCcFreshBudgets(pageRows.map((r) => r.slo.id));
  const displayRows = pageRows.map((r) => {
    const groups = freshBudgets.apply(r.slo, r.groups);
    return { ...r, groups, worst: ccWorstSloGroup(groups) };
  });

  const emptyState = (
    <CcEmptyState
      icon={Gauge}
      title="No SLOs defined"
      hint={
        <>
          Define an SLO as code with an SLI query, a target, and a rolling
          window. Everr tracks the error budget and burn-rate alerts.
        </>
      }
    />
  );

  const columns: Column<SloRow>[] = [
    {
      // `className` replaces DataTable's padding defaults rather than
      // extending them, hence restating them here.
      header: "Promise",
      className: "w-full pb-2 pr-4 pl-3",
      cellClassName: "w-full py-2 pr-4 pl-3",
      cell: ({ slo, health }) => <SloPromiseCell slo={slo} health={health} />,
    },
    {
      header: "",
      cell: ({ slo }) => <SloRunbookCell slo={slo} />,
    },
    {
      header: "Status",
      cell: (row) => <SloStatusCell row={row} />,
    },
    {
      // The tooltip carries the expansion and the word "estimate": the figure
      // is a projection of the current burn, not a countdown.
      header: (
        <span className="inline-flex items-center gap-1">
          TTE
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="What is TTE?"
                />
              }
            >
              <CircleHelp className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Time to exhaustion: an estimate of how long the error budget lasts
              if the current burn rate holds.
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => <SloExhaustionCell row={row} />,
    },
    {
      header: "Budget",
      className: "w-28 pb-2 pr-4",
      cellClassName: "w-28 py-2 pr-4",
      cell: (row) => <SloBudgetCell row={row} />,
    },
    {
      header: "",
      cell: ({ slo }) => (
        <span className="flex items-center justify-end">
          <CcPauseToggle
            paused={slo.paused}
            pending={toggle.isPending}
            kind="SLO"
            name={ccSloIdentity(slo).name}
            onToggle={() => toggle.mutate(slo)}
          />
        </span>
      ),
    },
  ];

  if (slos.isError) return <CcQueryError error={slos.error} />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="SLOs"
        lede="Promises, budgets, and whether anything needs attention now."
        docsHref="https://everr.dev/docs/concepts/how-slos-work"
      />
      <Card inset="flush-content">
        <CardContent>
          {slos.isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <>
              {displayRows.length === 0 ? (
                emptyState
              ) : (
                <>
                  {/* No whole-row click target, so controls and text stay
                      selectable. */}
                  <div className="hidden md:block">
                    <DataTable
                      data={displayRows}
                      columns={columns}
                      rowKey={(row) => row.slo.id}
                    />
                  </div>
                  <div className="md:hidden">
                    <div className="divide-y divide-border/60">
                      {displayRows.map((row) => (
                        <article key={row.slo.id} className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <span className="flex min-w-0 flex-col gap-1">
                              <SloPromiseCell slo={row.slo} />
                              <SloStatusCell row={row} />
                            </span>
                            <CcPauseToggle
                              paused={row.slo.paused}
                              pending={toggle.isPending}
                              kind="SLO"
                              name={ccSloIdentity(row.slo).name}
                              onToggle={() => toggle.mutate(row.slo)}
                            />
                          </div>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <SloExhaustionCell row={row} />
                            <SloBudgetCell row={row} />
                          </span>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {rows.length > SLO_PAGE_SIZE && (
                <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {pageStart + 1}-{pageStart + pageRows.length} of{" "}
                    {rows.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPageIndex(page - 1)}
                    >
                      <ChevronLeft data-icon="inline-start" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pageCount - 1}
                      onClick={() => setPageIndex(page + 1)}
                    >
                      Next
                      <ChevronRight data-icon="inline-end" />
                    </Button>
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
