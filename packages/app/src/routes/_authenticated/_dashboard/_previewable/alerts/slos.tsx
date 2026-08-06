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
import { alertingQueries } from "@/data/alerting/queries";
import { pauseAlertingSlo, resumeAlertingSlo } from "@/data/alerting/server";
import {
  type AlertingSloBurnPace,
  alertingFormatSloTarget,
  alertingSloBurnPaceLabel,
  alertingSloCurrentBurn,
  alertingSloExhaustion,
  alertingSloIdentity,
  alertingSloOverallPace,
  alertingSloTiers,
  alertingSloWindowLabel,
} from "@/data/alerting/slo";
import type {
  AlertingRuleHealthStatus,
  AlertingSlo,
  AlertingSloStatusPayload,
  AlertingSloTier,
} from "@/data/alerting/types";
import { fromAlertingSlo } from "@/data/slos/mapping";
import { AlertingBudgetBar } from "./-components/budget-bar";
import {
  AlertingEmptyState,
  AlertingHealthHeart,
  AlertingPauseToggle,
  AlertingQueryError,
  AlertingRunbookLink,
  AlertingTableSkeleton,
  alertingErrorMessage,
} from "./-components/shared";
import { useAlertingFreshBudgets } from "./-components/use-fresh-budgets";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/slos",
)({
  staticData: { breadcrumb: "SLOs" },
  head: () => ({ meta: [{ title: "Everr - Alerting SLOs" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchQuery(alertingQueries.slos(deps.preview)),
  component: AlertingSlosPage,
});

type SloRow = {
  slo: AlertingSlo;
  statusPending: boolean;
  tiers: AlertingSloTier[];
  snapshot: AlertingSloStatusPayload | null;
  status: { label: string; tone: string };
  /** Evaluator health, absent until the status snapshot resolves. */
  health?: AlertingRuleHealthStatus;
};

/** How many rows the listing shows per page (also the fresh-budget scan fan-out). */
const SLO_PAGE_SIZE = 10;

const TONE_URGENT = toneText({ tone: "danger", emphasis: "strong" });
const TONE_WARNING = toneText({ tone: "warning", emphasis: "strong" });
const TONE_ACTIVE = toneText({ tone: "live" });
const TONE_QUIET = toneText({ tone: "muted" });
const TONE_OK = toneText({ tone: "healthy" });

const PACE_TONE: Record<AlertingSloBurnPace, string> = {
  "burning-fast": TONE_URGENT,
  burning: TONE_WARNING,
  draining: TONE_ACTIVE,
  sustainable: TONE_OK,
  steady: TONE_OK,
};

// Pause/suppression outrank firing (neither evaluates or alerts). A firing
// row reports the tier's severity, never a delivery outcome: where an alert
// lands is the routing tree's business.
function rowStatus(row: Omit<SloRow, "status">): {
  label: string;
  tone: string;
} {
  if (row.slo.paused) return { label: "Paused", tone: TONE_QUIET };
  if (row.slo.spec.suppressed) {
    return { label: "Suppressed", tone: TONE_QUIET };
  }
  if (row.health === "degraded") {
    return { label: "Degraded", tone: TONE_WARNING };
  }
  if (row.snapshot === null)
    return { label: "Not evaluated", tone: TONE_QUIET };

  const pace = alertingSloOverallPace(row.tiers, row.snapshot);
  const label =
    pace === "sustainable" || pace === "steady"
      ? "OK"
      : alertingSloBurnPaceLabel(pace);
  return { label, tone: PACE_TONE[pace] };
}

function SloPromiseCell({
  slo,
  health,
}: {
  slo: AlertingSlo;
  health?: AlertingRuleHealthStatus;
}) {
  const identity = alertingSloIdentity(slo);
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
        <AlertingHealthHeart status={health} />
      </span>
      <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
        {alertingFormatSloTarget(slo.spec.targetPercent)} over{" "}
        {alertingSloWindowLabel(slo.spec)}
      </span>
    </span>
  );
}

function SloRunbookCell({ slo }: { slo: AlertingSlo }) {
  const { runbookProject, runbookSlug } = fromAlertingSlo(slo);
  if (!runbookSlug) return null;
  return (
    <AlertingRunbookLink
      project={runbookProject ?? "default"}
      slug={runbookSlug}
      name={alertingSloIdentity(slo).name}
    />
  );
}

function SloStatusCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-24" />;
  const { label, tone } = row.status;
  return <span className={`text-xs whitespace-nowrap ${tone}`}>{label}</span>;
}

function SloBudgetCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-36" />;
  return (
    <AlertingBudgetBar remaining={row.snapshot?.budget_remaining ?? null} />
  );
}

function SloExhaustionCell({ row }: { row: SloRow }) {
  if (row.statusPending) return <Skeleton className="h-4 w-16" />;
  const snapshot = row.snapshot;
  const readout = alertingSloExhaustion(
    snapshot?.budget_remaining ?? null,
    snapshot?.time_to_exhaustion_secs ?? null,
    snapshot === null
      ? null
      : (alertingSloCurrentBurn(row.tiers, snapshot.tiers)?.effective ?? null),
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

function AlertingSlosPage() {
  const qc = useQueryClient();
  const { preview } = Route.useSearch();
  const previewName = preview?.trim() || undefined;
  const [pageIndex, setPageIndex] = useState(0);
  const slos = useQuery(alertingQueries.slos(previewName));
  const slosData = slos.data ?? [];
  // One status query per SLO, cache-shared with the detail page.
  const statuses = useQueries({
    queries: slosData.map((s) => alertingQueries.sloStatus(s.id)),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["alerting", "slos"] });

  const toggle = useMutation({
    mutationFn: (slo: AlertingSlo) =>
      slo.paused
        ? resumeAlertingSlo({ data: { sloId: slo.id } })
        : pauseAlertingSlo({ data: { sloId: slo.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  const rows = slosData
    .map((slo, i) => ({
      slo,
      statusPending: statuses[i].isPending,
      snapshot: statuses[i].data?.payload ?? null,
      health: statuses[i].data?.health.status,
    }))
    // Fixed name order, independent of status: the list must never reshuffle
    // as snapshots resolve or budgets recompute.
    .sort((a, b) => a.slo.name.localeCompare(b.slo.name));

  // Only the visible page runs the (expensive) read-time budget scan.
  const pageCount = Math.max(1, Math.ceil(rows.length / SLO_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageStart = page * SLO_PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + SLO_PAGE_SIZE);

  const freshBudgets = useAlertingFreshBudgets(pageRows.map((r) => r.slo.id));
  const displayRows: SloRow[] = pageRows.map((r) => {
    const tiers = alertingSloTiers(r.slo.spec);
    const snapshot = r.snapshot ? freshBudgets.apply(r.slo, r.snapshot) : null;
    const row = { ...r, tiers, snapshot };
    return { ...row, status: rowStatus(row) };
  });

  const emptyState = (
    <AlertingEmptyState
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
          <AlertingPauseToggle
            paused={slo.paused}
            pending={toggle.isPending}
            kind="SLO"
            name={alertingSloIdentity(slo).name}
            onToggle={() => toggle.mutate(slo)}
          />
        </span>
      ),
    },
  ];

  if (slos.isError) return <AlertingQueryError error={slos.error} />;

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
            <AlertingTableSkeleton rows={5} />
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
                            <AlertingPauseToggle
                              paused={row.slo.paused}
                              pending={toggle.isPending}
                              kind="SLO"
                              name={alertingSloIdentity(row.slo).name}
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
