// SLO detail, in the order the question is actually asked: how's the budget
// right now (stats row + status hero), which way is it going (budget history,
// with the alert transitions folded underneath), what is it (the definition),
// and is the evaluator healthy (loud only when degraded).
import { Badge } from "@everr/ui/components/badge";
import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpenText,
  HeartCrack,
  Pause,
  Play,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertEventFeed,
  ccEventStatus,
} from "@/components/cc/alert-event-feed";
import {
  CcBudgetBar,
  ccFmtBurn,
  ccFmtFraction,
} from "@/components/cc/budget-bar";
import {
  CcDisclosureTrigger,
  CcEmptyState,
  CcQueryError,
  CcSloTierBadge,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
import {
  SloBudgetChart,
  type SloBudgetEvent,
} from "@/components/cc/slo-budget-chart";
import { SloStatsRow } from "@/components/cc/slo-status";
import {
  ANN_LABEL_PREFIX,
  ANN_PROJECT,
  isEverrAnnotationKey,
} from "@/data/alerts/annotations";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccApplyFreshBudget,
  ccFmtWindowLabel,
  ccSloChartRange,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloHandles,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccSloWindowSecs,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type {
  CcSlo,
  CcSloGroupStatus,
  CcSloHealth,
  CcSloView,
} from "@/data/cc/types";
import { fromCcSlo } from "@/data/slos/mapping";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/slos_/$project/$slug",
)({
  // This detail route is flat (slos_), so it doesn't inherit the SLOs listing
  // crumb — emit it here so the trail reads Alerts > SLOs > <name>.
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "SLOs", to: "/alerts/slos" },
      { label: match.loaderData?.name ?? "SLO" },
    ],
    // Every time-scoped surface on this page (budget chart, firing feed) is
    // pinned to the SLO's own window, not a floating picker: an SLO is defined
    // by its window, so its budget and history read cleanest over that span and
    // always agree with the status hero. Hide the global picker accordingly.
    hideTimeRangePicker: true,
  },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    // Fetch the SLO first: its window sets the range everything else reads.
    const slo = await queryClient.ensureQueryData(
      ccQueries.sloByName(params.project, params.slug, deps.preview),
    );
    const range = ccSloChartRange(slo.spec);
    await Promise.all([
      queryClient.prefetchQuery(ccQueries.sloStatus(slo.id)),
      // Budget series and event history (chart overlay + firing feed) share
      // this window range; the history prefetch is scoped to this SLO's
      // handles, matching what the page reads. Skipped for a spec whose
      // window doesn't parse (nothing to chart a trailing window over); the
      // feed then falls back to defaults.
      ...(range
        ? [
            queryClient.prefetchQuery(
              ccQueries.eventHistory(range, { slugs: ccSloHandles(slo) }),
            ),
            queryClient.prefetchQuery(ccQueries.sloBudgetSeries(slo.id, range)),
          ]
        : []),
    ]);
    return { name: ccSloIdentity(slo).name };
  },
  component: CcSloDetailPage,
});

function BackLink() {
  return (
    <Link
      to="/alerts/slos"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/50 hover:text-foreground"
      aria-label="Back to SLOs"
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
      {/* min-w-0 so a wide value (the SLI query) scrolls inside the row rather
          than stretching the card. */}
      <dd className="min-w-0 flex-1 font-mono text-xs">{children}</dd>
    </div>
  );
}

// Fraction/burn formatting is shared with the listing and overview surfaces
// (ccFmtFraction / ccFmtBurn from budget-bar.tsx).

// ── What is it ────────────────────────────────────────────────────────────────

function ObjectiveSection({ slo }: { slo: CcSlo }) {
  const ann = slo.spec.annotations;
  // Surface the as-code identity fields natively instead of behind a YAML dump.
  // `everr.project` and `everr.label.*` fold into first-class fields (as they do
  // in the applied document); `description` is the page header's, and `summary`
  // is the engine's alert template, so both are dropped here along with the rest
  // of the everr.* internals. What's left is the author's own pass-through
  // annotations, shown raw.
  const project = ann[ANN_PROJECT];
  const labels = Object.entries(ann)
    .filter(([k]) => k.startsWith(ANN_LABEL_PREFIX))
    .map(([k, v]) => [k.slice(ANN_LABEL_PREFIX.length), v] as const);
  const annotations = Object.entries(ann).filter(
    ([k]) => !isEverrAnnotationKey(k) && k !== "description" && k !== "summary",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Definition</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Target and window lead the stats row (the SLO stat), so the
            definition card carries only what isn't already on screen. */}
        <dl className="divide-y divide-border/60">
          {slo.spec.min_valid_events !== undefined && (
            <DefRow label="Min valid events">
              {slo.spec.min_valid_events}
            </DefRow>
          )}
          {/* Only when the SLI actually groups. A scalar SLI has nothing to
              list, and "no grouping columns" is not a fact anyone came here
              for: the page's single set of numbers already says so. */}
          {slo.spec.sli.label_columns.length > 0 && (
            <DefRow label="SLI groups by">
              {slo.spec.sli.label_columns.join(", ")}
            </DefRow>
          )}
          {project !== undefined && <DefRow label="Project">{project}</DefRow>}
          {labels.length > 0 && (
            <DefRow label="Labels">
              <span className="flex flex-col gap-0.5">
                {labels.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </DefRow>
          )}
          {annotations.length > 0 && (
            <DefRow label="Annotations">
              <span className="flex flex-col gap-0.5">
                {annotations.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </DefRow>
          )}
          {/* The query itself, as a field rather than a disclosure: this card is
              the one place the definition lives, and the SLI is the definition.
              What alerts is not restated here — the status hero states each
              tier's rule with its live numbers, which is the same rule. */}
          <DefRow label="SLI">
            <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs ring-1 ring-foreground/10">
              {slo.spec.sli.sql}
            </pre>
          </DefRow>
        </dl>
      </CardContent>
    </Card>
  );
}

// ── How's the budget ──────────────────────────────────────────────────────────

function StatusSection({ slo }: { slo: CcSlo }) {
  const status = useQuery(ccQueries.sloStatus(slo.id));
  // The budget as of page view: a read-time SLI scan that overrides the stored
  // snapshot's throttled budget once it lands. The snapshot renders instantly
  // meanwhile; this only refines budget/SLI/time-to-exhaustion.
  const fresh = useQuery(ccQueries.sloBudgetNow(slo.id));
  const tiers = ccSloTiers(slo.spec);

  const groupCols: Column<CcSloGroupStatus>[] = [
    {
      header: "Group",
      cell: (g) =>
        Object.keys(g.labels).length === 0 ? (
          // A scalar SLO has exactly one label-less group: name it honestly
          // instead of rendering an empty cell.
          <span className="text-xs text-muted-foreground">all traffic</span>
        ) : (
          <LabelSet labels={g.labels} />
        ),
    },
    {
      header: "SLI",
      cell: (g) => (
        <span className="font-mono text-xs tabular-nums">
          {g.sli !== null ? ccFmtFraction(g.sli) : "—"}
        </span>
      ),
    },
    {
      header: "Budget remaining",
      cell: (g) => <CcBudgetBar remaining={g.budget_remaining} />,
    },
    {
      // One headline number (the shortest-long-window tier's sustained burn);
      // the full per-tier long/short matrix stays reachable in the tooltip.
      header: "Burn rate",
      cell: (g) => {
        const burn = ccSloCurrentBurn(tiers, g.tiers);
        if (burn === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        // Tone from real state, not projection: firing tiers set the color; a
        // confirmed (both-window) burn above 1× still reads as "budget shrinking",
        // but a spike already gone (short back to 0) does not.
        const firingSeverities = g.firing_tiers.map((f) =>
          ccSloTierSeverity(tiers, { slo_tier: f.tier }),
        );
        const tone = firingSeverities.includes("critical")
          ? toneText({ tone: "danger", emphasis: "strong" })
          : firingSeverities.length > 0
            ? toneText({ tone: "warning", emphasis: "strong" })
            : (burn.effective ?? 0) >= 1
              ? toneText({ tone: "live" })
              : "text-muted-foreground";
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={`font-mono text-xs tabular-nums ${tone}`} />
              }
            >
              {ccFmtBurn(burn.rate)}
              <span className="text-muted-foreground">
                {" "}
                · last {ccFmtWindowLabel(burn.window)}
              </span>
            </TooltipTrigger>
            <TooltipContent className="space-y-1.5">
              <p className="max-w-56 text-xs">
                Average burn over each alert window; 1&times; spends exactly the
                budget over {ccSloWindowLabel(slo.spec)}. A tier fires when both
                its windows reach its threshold.
              </p>
              <table className="font-mono text-[0.6875rem] tabular-nums">
                <tbody>
                  {tiers.map((t) => {
                    const snap = g.tiers.find((s) => s.name === t.name);
                    return (
                      <tr key={t.name}>
                        <td className="pr-2">{t.name}</td>
                        <td className="pr-2">
                          {snap?.long_burn_rate != null
                            ? ccFmtBurn(snap.long_burn_rate)
                            : "—"}{" "}
                          last {ccFmtWindowLabel(t.long_window)}
                        </td>
                        <td className="pr-2">
                          {snap?.short_burn_rate != null
                            ? ccFmtBurn(snap.short_burn_rate)
                            : "—"}{" "}
                          last {ccFmtWindowLabel(t.short_window)}
                        </td>
                        <td>fires &ge;{ccFmtBurn(t.burn_rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      header: "Time to exhaustion",
      cell: (g) => (
        <span className="whitespace-nowrap font-mono text-xs tabular-nums">
          {
            ccSloExhaustion(
              g.budget_remaining,
              g.time_to_exhaustion_secs,
              ccSloCurrentBurn(tiers, g.tiers)?.effective ?? null,
            ).label
          }
        </span>
      ),
    },
    {
      header: "Firing tiers",
      cell: (g) =>
        g.firing_tiers.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-2">
            {g.firing_tiers.map((f) => (
              <CcSloTierBadge
                key={f.tier}
                tier={f.tier}
                severity={ccSloTierSeverity(tiers, { slo_tier: f.tier })}
              />
            ))}
          </span>
        ),
    },
  ];

  if (status.isError) {
    return <CcQueryError error={status.error} />;
  }
  if (status.isPending) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  const data = status.data;
  if (!data || data.payload === null) {
    // No snapshot row yet (a new SLO before its first evaluation tick), or a
    // stored payload predating the current snapshot shape.
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <CcEmptyState
            title="No status snapshot yet"
            hint="The evaluator writes a snapshot on its first evaluation tick; until then there is no SLI or error budget to show."
          />
        </CardContent>
      </Card>
    );
  }
  if (data.payload.groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <CcEmptyState
            title="No SLI groups yet"
            hint="The SLI query has not returned rows for any group in the budget window."
          />
        </CardContent>
      </Card>
    );
  }

  // The budget shown is read-time-fresh once the scan lands; until then the
  // stored snapshot is the instant fallback. Overriding budget/SLI/TTE per group
  // can change which group is worst, so merge before picking the headline. An
  // empty scan (no traffic in the trailing window) leaves the snapshot unchanged,
  // so it is not "fresh" — require the scan to have produced groups.
  const budgetIsFresh = fresh.data !== undefined && fresh.data.length > 0;
  const groups = ccApplyFreshBudget(
    ccSloTiers(slo.spec),
    data.payload.groups,
    fresh.data,
    ccSloWindowSecs(slo.spec),
  );
  const worst = ccWorstSloGroup(groups);

  // A fragment, not a stack of its own: these are top-level cards of the page,
  // and the page's own spacing should set the rhythm for all of them. A wrapper
  // here would space its children on its own terms and read as a tighter
  // cluster than the cards below it.
  return (
    <>
      {/* The headline numbers as one strip: budget, promise, SLI, burn, and
          the horizon — all the worst group's, same as the chart below. */}
      <SloStatsRow slo={slo} worst={worst} />
      {/* Said only while the read-time scan is still in flight, because that is
          the only case a reader can act on: the numbers above are the stored
          snapshot for another moment. Once the scan lands they are simply
          current, and a page that announces its own freshness in the steady
          state is announcing nothing. */}
      {!budgetIsFresh && (
        <p className="px-1 text-[0.6875rem] text-muted-foreground">
          Error budget computing&hellip;
        </p>
      )}

      {/* The per-group breakdown, shown outright whenever there is more than
          one group. The stats above are only the WORST group's, so with
          several groups this table is the rest of the answer, not detail: a
          fold would hide the very rows those numbers are not about. */}
      {groups.length > 1 && (
        // flush-content: the table's own rows carry the horizontal rhythm, so
        // it runs to the card's edges and its rules read as full-width
        // separators instead of floating short of both sides.
        <Card inset="flush-content">
          <CardHeader>
            <span className="text-xs font-medium">All groups</span>
          </CardHeader>
          <CardContent>
            <DataTable
              data={groups}
              columns={groupCols}
              rowKey={(g) => JSON.stringify(g.labels)}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── How's the budget trending ─────────────────────────────────────────────────

// Placeholder range for the budget/event queries while they are disabled (a
// spec whose window doesn't parse). It only seeds the query key; `enabled` keeps
// it from ever fetching. The live range is `ccSloChartRange(slo.spec)`.
const CHART_RANGE_FALLBACK = { from: "now-1d", to: "now" } as const;

function BudgetHistorySection({ slo }: { slo: CcSloView }) {
  // The chart is pinned to one SLO window ending now, so its rightmost point
  // reads the same span as the status hero and the two always agree.
  const range = ccSloChartRange(slo.spec);
  const series = useQuery({
    ...ccQueries.sloBudgetSeries(slo.id, range ?? CHART_RANGE_FALLBACK),
    enabled: range !== null,
  });
  // The same fire/resolve transitions the history feed below shows, overlaid on
  // the budget line so a drop lines up with the tier that fired. Scoped to this
  // SLO's handles server-side, so the row cap applies after scoping and busy
  // tenants can't push this SLO's markers out of the newest-N window;
  // non-transition events (deliveries, silences) drop out.
  const events = useQuery({
    ...ccQueries.eventHistory(range ?? CHART_RANGE_FALLBACK, {
      slugs: ccSloHandles(slo),
    }),
    enabled: range !== null,
  });
  const budgetEvents = useMemo<SloBudgetEvent[]>(() => {
    const handles = new Set(ccSloHandles(slo));
    const out: SloBudgetEvent[] = [];
    for (const e of events.data ?? []) {
      if (!handles.has(e.slug)) continue;
      const type = ccEventStatus(e.eventType);
      // `slo_tier` rides in the instance labels, and is what makes a marker's
      // tooltip worth having: which tier fired, not just that something did.
      if (type) out.push({ t: e.timestamp, type, tier: e.labels.slo_tier });
    }
    return out;
  }, [events.data, slo]);

  // A spec whose window doesn't parse can't be charted; the objective card
  // still states the window, so no error card is owed here.
  if (range === null) return null;

  return (
    <Card>
      <CardHeader>
        {/* Every mark on the chart carries its own label, so no "how to read
            this" tooltip is owed here. */}
        <CardTitle>Budget history</CardTitle>
        <CardDescription>
          Budget remaining over a trailing {ccSloWindowLabel(slo.spec)} window.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {series.isError ? (
          <CcQueryError error={series.error} />
        ) : series.isPending ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <SloBudgetChart
            groups={series.data}
            epoch={slo.budget_epoch}
            events={budgetEvents}
          />
        )}
        <FiringHistoryFold slo={slo} />
      </CardContent>
    </Card>
  );
}

// The same transitions the chart marks, in full: which tier fired, and whether
// anyone was told. It sits folded under the chart, where it explains the marks
// you have just looked at rather than opening a second reading of them.
//
// Scoped to this SLO's handles and pinned to the same SLO window as the chart
// (the picker is hidden on this page) so the two line up. hideRuleColumns drops
// the (constant) source and severity columns, leaving Time / Event / Labels —
// the tier rides in the labels as `slo_tier`.
function FiringHistoryFold({ slo }: { slo: CcSlo }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CcDisclosureTrigger open={open}>
        <span className="text-xs font-medium">Alert history</span>
        {!open && (
          <span className="text-[0.6875rem] text-muted-foreground">
            every tier that fired or resolved in this window
          </span>
        )}
      </CcDisclosureTrigger>
      <CollapsibleContent>
        <div className="mt-2">
          <AlertEventFeed
            scopeSlug={ccSloHandles(slo)}
            hideRuleColumns
            showTypeLens
            timeRange={ccSloChartRange(slo.spec) ?? undefined}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Is it healthy ─────────────────────────────────────────────────────────────

function HealthSection({ sloId }: { sloId: string }) {
  const status = useQuery(ccQueries.sloStatus(sloId));
  // Health rides on the status read; without a snapshot there is no health
  // row to show yet, and the budget section already explains the pending
  // state — no card at all beats an empty shell.
  if (!status.data) return null;
  const health: CcSloHealth = status.data.health;
  // The stats row carries the healthy readout; this card exists only for the
  // degraded forensics, where loud is right — the SLI query is failing, so
  // every number above is going stale.
  if (health.status !== "degraded") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evaluator</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 shrink-0" />
            Evaluation degraded since {ccFormatTs(health.degraded_since)}
          </p>
          {health.last_error && (
            <p className="font-mono text-xs break-all opacity-90">
              {health.last_error}
            </p>
          )}
          <p className="text-xs opacity-90">
            The SLI query is failing; the error budget snapshot stops updating
            until it evaluates again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CcSloDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const slo = useQuery(ccQueries.sloByName(project, slug, preview));
  // Evaluator health rides the (cache-shared, polling) status read. Healthy
  // is the normal system state and stays silent; only degraded surfaces, as
  // the broken heart beside the title.
  const sloId = slo.data?.id;
  const status = useQuery({
    ...ccQueries.sloStatus(sloId ?? ""),
    enabled: sloId !== undefined,
  });
  const evaluatorBroken = status.data?.health.status === "degraded";

  const toggle = useMutation({
    mutationFn: (paused: boolean) => {
      const id = slo.data?.id;
      if (!id) throw new Error("SLO not loaded");
      return paused
        ? resumeCcSlo({ data: { sloId: id } })
        : pauseCcSlo({ data: { sloId: id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ccQueries.sloByName(project, slug, preview).queryKey,
      });
      // The SLOs listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ["cc", "slos"] });
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  if (slo.isError) return <CcQueryError error={slo.error} />;

  if (!slo.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const s = slo.data;
  const view = fromCcSlo(s);
  const identity = ccSloIdentity(s);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          {/* The evaluator breaking is the one system fault worth wearing on
              the title: the SLI query is failing, so every number below is
              going stale. Healthy stays silent. */}
          {evaluatorBroken && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Evaluator degraded"
                    className="text-destructive"
                  />
                }
              >
                <HeartCrack className="size-4" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                The evaluator is degraded: the SLI query is failing and the
                numbers below are going stale. Details in the Evaluator card at
                the bottom.
              </TooltipContent>
            </Tooltip>
          )}
          {/* The promise itself (target over window) leads the stats row
              below, so the header carries just the name and its flags. */}
          {s.paused && <Badge variant="secondary">paused</Badge>}
          {s.spec.suppressed && (
            // Evaluates fully but never notifies — worth a loud flag.
            <Badge variant="destructive">suppressed</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view.runbookSlug && (
            <Link
              to="/runbooks/$project/$slug"
              params={{
                project: view.runbookProject ?? "default",
                slug: view.runbookSlug,
              }}
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              <BookOpenText data-icon="inline-start" />
              Runbook
            </Link>
          )}
          <Button
            variant="outline"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(s.paused)}
          >
            {s.paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {s.paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      {view.displayDescription && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {view.displayDescription}
        </p>
      )}

      <StatusSection slo={s} />
      <BudgetHistorySection slo={s} />
      <ObjectiveSection slo={s} />
      <HealthSection sloId={s.id} />
    </div>
  );
}
