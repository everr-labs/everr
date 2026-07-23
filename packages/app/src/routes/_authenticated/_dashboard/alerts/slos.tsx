// SLO listing, led by status: each row answers "how is this promise doing" —
// error budget, burn rate, time to exhaustion, firing tiers — before showing
// the config that produced it. Rows sort by name: a fixed order that never
// depends on the (independently-resolving, continuously-recomputed) status, so
// the list never reshuffles under the reader. Risk is read off the row, not its
// position.
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Gauge, Pause, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CcBudgetBar, ccFmtBurn } from "@/components/cc/budget-bar";
import { CcPageIntro } from "@/components/cc/page-intro";
import {
  CcEmptyState,
  CcQueryError,
  CcSloTierBadge,
  CcTableSkeleton,
  ccErrorMessage,
} from "@/components/cc/shared";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccApplyFreshBudget,
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloBurnPace,
  ccSloBurnPaceLabel,
  ccSloCurrentBurn,
  ccSloGroupBreakdown,
  ccSloGroupState,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccSloWindowSecs,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/slos")({
  staticData: { breadcrumb: "SLOs" },
  head: () => ({ meta: [{ title: "Everr - Alerts SLOs" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchQuery(ccQueries.slos(deps.preview)),
  component: CcSlosPage,
});

// One listing row: the SLO plus its resolved status groups. `worst` is the
// group spending budget fastest (min budget remaining) — the row's headline —
// and `groups` is the full set, both freshened with the read-time budget scan
// for the visible page (ccApplyFreshBudget). The cells read firing state and the
// group breakdown straight off these, so the row carries no derived duplicates.
type SloRow = {
  slo: CcSlo;
  statusPending: boolean;
  groups: CcSloGroupStatus[];
  worst: CcSloGroupStatus | null;
};

/** How many rows the listing shows per page (also the fresh-budget scan fan-out). */
const SLO_PAGE_SIZE = 10;

function rowBurn(row: SloRow) {
  if (row.worst === null) return null;
  const tiers = ccSloTiers(row.slo.spec);
  const burn = ccSloCurrentBurn(tiers, row.worst.tiers);
  const firing = row.worst.firing_tiers.map((f) => ({
    tier: f.tier,
    severity: ccSloTierSeverity(tiers, { slo_tier: f.tier }),
  }));
  const pace = ccSloBurnPace(burn?.effective ?? null, firing);
  return { burn, firing, pace };
}

function paceTone(pace: ReturnType<typeof ccSloBurnPace>): string {
  return pace === "burning-fast"
    ? "font-medium text-destructive"
    : pace === "burning"
      ? "font-medium text-amber-600 dark:text-amber-400"
      : pace === "draining"
        ? "text-foreground"
        : "text-muted-foreground";
}

function rowStateLabel({
  state,
  pace,
}: {
  state: ReturnType<typeof ccSloGroupState>;
  pace: ReturnType<typeof ccSloBurnPace> | null;
}): string {
  switch (state) {
    case "unknown":
      return "Not evaluated";
    case "exhausted":
      return "Budget exhausted";
    case "firing-critical":
      return "Paging";
    case "firing-warning":
      return "Alert firing";
    case "at-risk":
      return "Low budget";
    case "healthy":
      return pace === "draining" ? "Draining" : "On track";
  }
}

function rowExhaustionLabel({
  tteSecs,
  burn,
  firingCount,
}: {
  tteSecs: number | null;
  burn: ReturnType<typeof rowBurn>;
  firingCount: number;
}): string {
  if (tteSecs === 0) return "exhausted";
  if (tteSecs !== null) return `${ccFormatSloDuration(tteSecs)} to empty`;
  if (firingCount > 0) {
    return burn?.burn?.effective === 0
      ? "current burn stopped"
      : "forecast unavailable";
  }
  return "no exhaustion forecast";
}

// The receding-firing case (a tier still firing on a burst whose spending has
// stopped): say it as the story instead of a bare window figure.
function firingWindowLabel(row: SloRow, firing: { tier: string }[]): string {
  const first = firing[0]?.tier;
  if (first === undefined || row.worst === null)
    return "firing on earlier burn";
  const snap = row.worst.tiers.find((t) => t.name === first);
  const rate =
    snap?.long_burn_rate !== null && snap?.long_burn_rate !== undefined
      ? ` (${ccFmtBurn(snap.long_burn_rate)})`
      : "";
  return `${first} firing on earlier burn${rate}`;
}

function SloPromiseCell({
  slo: s,
  compact = false,
}: {
  slo: CcSlo;
  compact?: boolean;
}) {
  return (
    <span className={`flex flex-col gap-1 ${compact ? "min-w-0" : "min-w-56"}`}>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          to="/alerts/slos/$sloId"
          params={{ sloId: s.id }}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {s.name}
        </Link>
        {s.paused && <Badge variant="secondary">paused</Badge>}
        {s.spec.suppressed && <Badge variant="destructive">suppressed</Badge>}
      </span>
      <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
        {ccFormatSloTarget(s.spec.targetPercent)} over{" "}
        {ccSloWindowLabel(s.spec)}
        {s.spec.sli.label_columns.length > 0 && (
          <>
            {" · by "}
            <span className="font-mono">
              {s.spec.sli.label_columns.join(", ")}
            </span>
          </>
        )}
      </span>
    </span>
  );
}

function SloNowCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-40" />;
  if (row.worst === null) {
    return (
      <span className="text-xs text-muted-foreground">no snapshot yet</span>
    );
  }
  const burn = rowBurn(row);
  const firing = burn?.firing ?? [];
  const state = ccSloGroupState(ccSloTiers(row.slo.spec), row.worst);
  return (
    <span className="flex max-w-md flex-col gap-1">
      <span className="text-xs font-medium text-foreground">
        {rowStateLabel({ state, pace: burn?.pace ?? null })}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
        {burn && burn.burn?.effective === 0 && firing.length > 0 ? (
          <span className={paceTone(burn.pace)}>
            {firingWindowLabel(row, firing)}
          </span>
        ) : burn && burn.pace !== "steady" ? (
          <span className={paceTone(burn.pace)}>
            {ccSloBurnPaceLabel(burn.pace)}
            {burn.burn !== null && (
              <span className="ml-1 font-mono tabular-nums text-muted-foreground">
                {ccFmtBurn(burn.burn.rate)}
              </span>
            )}
          </span>
        ) : (
          <span>Steady</span>
        )}
        <span>
          {rowExhaustionLabel({
            tteSecs: row.worst.time_to_exhaustion_secs,
            burn,
            firingCount: firing.length,
          })}
        </span>
        {firing.map((f) => (
          <CcSloTierBadge key={f.tier} tier={f.tier} severity={f.severity} />
        ))}
      </span>
    </span>
  );
}

function SloBudgetCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-40" />;
  if (row.worst === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const b = ccSloGroupBreakdown(ccSloTiers(row.slo.spec), row.groups);
  const worstLabels = Object.values(row.worst.labels);
  return (
    <span className="flex flex-col gap-0.5">
      <CcBudgetBar remaining={row.worst.budget_remaining} />
      {b.total > 1 && (
        <span className="text-[0.6875rem] text-muted-foreground">
          worst of {b.total} groups
          {b.firing > 0 && (
            <span className="text-destructive"> · {b.firing} firing</span>
          )}
          {b.exhausted > 0 && (
            <span className="text-destructive"> · {b.exhausted} exhausted</span>
          )}
          {b.atRisk > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              · {b.atRisk} at risk
            </span>
          )}
          {worstLabels.length > 0 && (
            <>
              {": "}
              <span className="font-mono">{worstLabels.join(", ")}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function CcSlosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { preview } = Route.useSearch();
  const previewName = preview?.trim() || undefined;
  const [pageIndex, setPageIndex] = useState(0);
  const slos = useQuery(ccQueries.slos(previewName));
  const slosData = slos.data ?? [];
  // One status query per SLO, cache-shared with the detail page. The listing
  // is small (a tenant's SLO set), so per-row polling stays cheap.
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
      };
    })
    // Sorted by name only: a fixed order independent of status, so the list
    // never reshuffles as snapshots resolve one by one or budgets recompute.
    .sort((a, b) => a.slo.name.localeCompare(b.slo.name));

  // Client-side pagination: the tenant's whole SLO set is loaded for the risk
  // sort, but only one page is shown — and only the visible page runs the
  // (expensive) read-time budget scan, so the fan-out is bounded to a page.
  const pageCount = Math.max(1, Math.ceil(rows.length / SLO_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageStart = page * SLO_PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + SLO_PAGE_SIZE);

  // The current page's budget as of page view. Keyed per SLO, so navigating to a
  // row's detail page reuses this cache. Merged onto the snapshot for display;
  // the snapshot stays the instant fallback while a scan is in flight.
  const freshBudgets = useQueries({
    queries: pageRows.map((r) => ccQueries.sloBudgetNow(r.slo.id)),
  });
  const displayRows = pageRows.map((r, i) => {
    const fresh = freshBudgets[i]?.data;
    if (fresh === undefined) return r;
    const groups = ccApplyFreshBudget(
      ccSloTiers(r.slo.spec),
      r.groups,
      fresh,
      ccSloWindowSecs(r.slo.spec),
    );
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
      header: "Promise",
      cell: ({ slo }) => <SloPromiseCell slo={slo} />,
    },
    {
      header: "Now",
      cell: (row) => <SloNowCell row={row} />,
    },
    {
      // The worst group's budget is the headline; for a multi-group SLO a second
      // line says how many of the rest also need attention (firing / exhausted /
      // at risk), so the bar isn't hiding a fleet of struggling groups behind it.
      header: "Budget",
      cell: (row) => <SloBudgetCell row={row} />,
    },
    {
      header: "",
      cell: ({ slo: s }) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(s)}
          >
            {s.paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {s.paused ? "Resume" : "Pause"}
          </Button>
        </span>
      ),
    },
  ];

  if (slos.isError) return <CcQueryError error={slos.error} />;

  return (
    <div className="space-y-3">
      <CcPageIntro
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
                  <div className="hidden md:block">
                    <DataTable
                      data={displayRows}
                      columns={columns}
                      rowKey={(row) => row.slo.id}
                      onRowClick={(row, e) => {
                        if (
                          (e.target as HTMLElement).closest("a,button") !== null
                        ) {
                          return;
                        }
                        void navigate({
                          to: "/alerts/slos/$sloId",
                          params: { sloId: row.slo.id },
                        });
                      }}
                    />
                  </div>
                  <div className="md:hidden">
                    <div className="divide-y divide-border/60">
                      {displayRows.map((row) => (
                        <article key={row.slo.id} className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <SloPromiseCell slo={row.slo} compact />
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={toggle.isPending}
                              onClick={() => toggle.mutate(row.slo)}
                            >
                              {row.slo.paused ? (
                                <Play data-icon="inline-start" />
                              ) : (
                                <Pause data-icon="inline-start" />
                              )}
                              {row.slo.paused ? "Resume" : "Pause"}
                            </Button>
                          </div>
                          <SloNowCell row={row} />
                          <SloBudgetCell row={row} />
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
