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
  CcStatusDot,
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
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(ccQueries.slos()),
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

function CcSlosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pageIndex, setPageIndex] = useState(0);
  const slos = useQuery(ccQueries.slos());
  const slosData = slos.data ?? [];
  // One status query per SLO, cache-shared with the detail page. The listing
  // is small (a tenant's SLO set), so per-row polling stays cheap.
  const statuses = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ccQueries.slos().queryKey });

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

  const columns: Column<SloRow>[] = [
    {
      header: "SLO",
      cell: ({ slo: s }) => (
        <span className="flex flex-col gap-0.5">
          <Link
            to="/alerts/slos/$sloId"
            params={{ sloId: s.id }}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {s.name}
          </Link>
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
      ),
    },
    {
      // The worst group's budget is the headline; for a multi-group SLO a second
      // line says how many of the rest also need attention (firing / exhausted /
      // at risk), so the bar isn't hiding a fleet of struggling groups behind it.
      header: "Error budget",
      cell: (row) => {
        if (row.statusPending) return <Skeleton className="h-4 w-40" />;
        if (row.worst === null) {
          return (
            <span className="text-xs text-muted-foreground">
              no snapshot yet
            </span>
          );
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
                  <span className="text-destructive">
                    {" "}
                    · {b.exhausted} exhausted
                  </span>
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
      },
    },
    {
      // Burn folds in what used to be a separate "Firing" column: the pace word
      // (Draining / Sustainable / Burning) leads with the multiplier as quiet
      // support, and when a tier is actually paging its badges sit beneath — the
      // word carries severity, the badges name which windows tripped. The
      // tier-window suffix ("/ 1h") is dropped; time to exhaustion is the "when".
      header: "Burn",
      cell: (row) => {
        if (row.statusPending || row.worst === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const tiers = ccSloTiers(row.slo.spec);
        const burn = ccSloCurrentBurn(tiers, row.worst.tiers);
        const firing = row.worst.firing_tiers.map((f) => ({
          tier: f.tier,
          severity: ccSloTierSeverity(tiers, { slo_tier: f.tier }),
        }));
        const pace = ccSloBurnPace(burn?.effective ?? null, firing);
        if (pace === "steady") {
          return <span className="text-xs text-muted-foreground">Steady</span>;
        }
        const tone =
          pace === "burning-fast"
            ? "font-medium text-destructive"
            : pace === "burning"
              ? "font-medium text-amber-600 dark:text-amber-400"
              : pace === "draining"
                ? "text-foreground"
                : "text-muted-foreground";
        return (
          <span className="flex flex-col items-start gap-1">
            <span className={`text-xs whitespace-nowrap ${tone}`}>
              {ccSloBurnPaceLabel(pace)}
              {burn !== null && (
                <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                  {ccFmtBurn(burn.rate)}
                </span>
              )}
            </span>
            {firing.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {firing.map((f) => (
                  <CcSloTierBadge
                    key={f.tier}
                    tier={f.tier}
                    severity={f.severity}
                  />
                ))}
              </span>
            )}
          </span>
        );
      },
    },
    {
      header: "Time to exhaustion",
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums whitespace-nowrap">
          {row.worst === null || row.worst.time_to_exhaustion_secs === null
            ? "—"
            : row.worst.time_to_exhaustion_secs === 0
              ? "exhausted"
              : ccFormatSloDuration(row.worst.time_to_exhaustion_secs)}
        </span>
      ),
    },
    {
      header: "State",
      cell: ({ slo: s }) => (
        <span className="inline-flex items-center gap-2">
          {s.paused ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CcStatusDot tone="inactive" />
              paused
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CcStatusDot tone="healthy" />
              active
            </span>
          )}
          {s.spec.suppressed && (
            // Evaluates fully but the dispatcher never notifies — worth a
            // loud flag, or the silence is invisible.
            <Badge variant="destructive">suppressed</Badge>
          )}
        </span>
      ),
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
        lede="Reliability targets with an error budget: how much failure is affordable before each promise breaks."
        docsHref="https://everr.dev/docs/concepts/how-slos-work"
      />
      <Card inset="flush-content">
        <CardContent>
          {slos.isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <>
              <DataTable
                data={displayRows}
                columns={columns}
                rowKey={(row) => row.slo.id}
                onRowClick={(row, e) => {
                  if ((e.target as HTMLElement).closest("a,button") !== null) {
                    return;
                  }
                  void navigate({
                    to: "/alerts/slos/$sloId",
                    params: { sloId: row.slo.id },
                  });
                }}
                emptyState={
                  <CcEmptyState
                    icon={Gauge}
                    title="No SLOs defined"
                    hint={
                      <>
                        Define an SLO as code — an SLI query with{" "}
                        <code>good</code>/<code>valid</code> counts, a target,
                        and a rolling window — and apply it with{" "}
                        <code>everr apply</code>. The engine tracks the error
                        budget and alerts on burn rate.
                      </>
                    }
                  />
                }
              />
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
