// SLO listing, distilled to what decides whether to open one: which promise,
// whether it needs a human now, when the budget runs out, and how much is left.
// The status detail the row used to pile on — burn multiples, per-group
// breakdown, firing tier names — is one click behind the name on the detail
// page. Rows sort by name: a fixed order that never depends on the
// (independently-resolving, continuously-recomputed) status, so the list never
// reshuffles under the reader. Risk is read off the row, not its position.
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
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Gauge,
  Pause,
  Play,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CcBudgetBar } from "@/components/cc/budget-bar";
import { CcPageIntro } from "@/components/cc/page-intro";
import {
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  ccErrorMessage,
} from "@/components/cc/shared";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccApplyFreshBudget,
  ccFormatSloTarget,
  ccSloBurnPace,
  ccSloBurnPaceLabel,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccSloWindowSecs,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";
import { fromCcSlo } from "@/data/slos/mapping";

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
// for the visible page (ccApplyFreshBudget).
type SloRow = {
  slo: CcSlo;
  statusPending: boolean;
  groups: CcSloGroupStatus[];
  worst: CcSloGroupStatus | null;
};

/** How many rows the listing shows per page (also the fresh-budget scan fan-out). */
const SLO_PAGE_SIZE = 10;

const TONE_URGENT = toneText({ tone: "danger", emphasis: "strong" });
const TONE_WARNING = toneText({ tone: "warning", emphasis: "strong" });
const TONE_ACTIVE = toneText({ tone: "live" });
const TONE_QUIET = toneText({ tone: "muted" });

/**
 * The one thing the budget column cannot say: is anything alerting, and is the
 * spending still happening. It never repeats "exhausted" — the budget column
 * already prints that — so a stopped burn on a drained budget reads
 * "exhausted / Steady". Pause and suppression outrank both, since neither one is
 * evaluating or alerting, and saying so is what explains the silence.
 *
 * A firing row reports the tier's *severity*, never a delivery outcome: no
 * channel type here is a pager, and where an alert actually lands is the routing
 * tree's business, which the SLO knows nothing about.
 */
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

  // Nothing firing: the pace word. Firing is passed as empty because the cases
  // it would produce are already returned above.
  const burn = ccSloCurrentBurn(tiers, row.worst.tiers)?.effective ?? null;
  const pace = ccSloBurnPace(burn, []);
  return {
    label: ccSloBurnPaceLabel(pace),
    tone: pace === "draining" ? TONE_ACTIVE : TONE_QUIET,
  };
}

// The name plus the line that says what the promise is. Target, window and SLI
// grouping are the promise's identity, not a second reading of its status, which
// is why they survived the cut that took the status detail.
function SloPromiseCell({ slo }: { slo: CcSlo }) {
  const identity = ccSloIdentity(slo);
  const { label_columns } = slo.spec.sli;
  return (
    <span className="flex flex-col gap-1">
      <Link
        to="/alerts/slos/$project/$slug"
        params={{ project: identity.project, slug: identity.slug }}
        // Never wrap a name onto a second line: this column is the flexible one,
        // so it is what gives when the viewport tightens. Not truncate either —
        // `overflow:hidden` would let the column collapse to nothing.
        className="font-medium whitespace-nowrap text-foreground underline-offset-2 hover:underline"
      >
        {identity.name}
      </Link>
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

// The runbook, when the SLO names one: the thing you actually want the moment a
// budget is draining. Nothing at all when it does not, rather than a dash — an
// absent runbook is not a value worth a glyph on every row.
function SloRunbookCell({ slo }: { slo: CcSlo }) {
  const { runbookProject, runbookSlug } = fromCcSlo(slo);
  if (!runbookSlug) return null;
  const { name } = ccSloIdentity(slo);
  return (
    <Link
      to="/runbooks/$project/$slug"
      params={{ project: runbookProject ?? "default", slug: runbookSlug }}
      aria-label={`Open runbook for ${name}`}
      title="Open runbook"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:bg-muted/50 hover:text-foreground focus-visible:outline-primary"
    >
      <BookOpenText className="size-3.5" />
    </Link>
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

// When the budget runs out, through the shared readout so this cell, the detail
// hero and the per-group table always agree about the same group.
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

function SloPauseButton({
  slo,
  pending,
  onToggle,
}: {
  slo: CcSlo;
  pending: boolean;
  onToggle: (slo: CcSlo) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => onToggle(slo)}
    >
      {slo.paused ? (
        <Play data-icon="inline-start" />
      ) : (
        <Pause data-icon="inline-start" />
      )}
      {slo.paused ? "Resume" : "Pause"}
    </Button>
  );
}

function CcSlosPage() {
  const qc = useQueryClient();
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
      // Promise soaks up every spare pixel, so the reading columns and the
      // action hold the right edge at any width. (`className` replaces
      // DataTable's padding defaults rather than extending them, hence
      // restating them here.)
      header: "Promise",
      className: "w-full pb-2 pr-4 pl-3",
      cellClassName: "w-full py-2 pr-4 pl-3",
      cell: ({ slo }) => <SloPromiseCell slo={slo} />,
    },
    {
      // Unlabelled and only as wide as the icon: most SLOs have no runbook, and
      // a titled column would spend header width on a mostly-empty cell. Mirrors
      // the same slot on the rules listing, so both alert lists reach a runbook
      // the same way.
      header: "",
      cell: ({ slo }) => <SloRunbookCell slo={slo} />,
    },
    {
      header: "Status",
      cell: (row) => <SloStatusCell row={row} />,
    },
    {
      // Ahead of the budget: when it runs out, then how much is left.
      // Abbreviated because the column is narrow and the phrase is not: the
      // tooltip carries the expansion, and the word "estimate" with it, since
      // the figure is a projection of the current burn and not a countdown.
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
      // Sized here rather than on the meter: the bar fills whatever the column
      // gives it, so the width lives with the layout that owns it.
      header: "Budget",
      className: "w-28 pb-2 pr-4",
      cellClassName: "w-28 py-2 pr-4",
      cell: (row) => <SloBudgetCell row={row} />,
    },
    {
      header: "",
      cell: ({ slo }) => (
        <span className="flex items-center justify-end">
          <SloPauseButton
            slo={slo}
            pending={toggle.isPending}
            onToggle={toggle.mutate}
          />
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
                  {/* No whole-row click target: the name link is the one way in,
                      so controls and text stay selectable. */}
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
                            <SloPauseButton
                              slo={row.slo}
                              pending={toggle.isPending}
                              onToggle={toggle.mutate}
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
