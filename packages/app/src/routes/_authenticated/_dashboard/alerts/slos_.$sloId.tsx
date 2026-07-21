// SLO detail, organized like the rule detail page: What is it (the
// objective: target, window, tiers, SLI SQL behind a disclosure), How's the
// budget (the evaluator's latest status snapshot per group), Is it healthy
// (evaluation health, loud only when degraded).
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Info, Pause, Play, TriangleAlert } from "lucide-react";
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
  CcHealthBadge,
  CcQueryError,
  CcSeverityBadge,
  CcSloTierBadge,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
import {
  SloBudgetChart,
  type SloBudgetEvent,
} from "@/components/cc/slo-budget-chart";
import { SloStatusHero } from "@/components/cc/slo-status";
import {
  ANN_LABEL_PREFIX,
  ANN_PROJECT,
  isEverrAnnotationKey,
} from "@/data/alerts/annotations";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  CC_CANONICAL_SLO_TIERS,
  ccApplyFreshBudget,
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloHandles,
  ccSloTierSeverity,
  ccSloWindowLabel,
  ccSloWindowSecs,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type {
  CcSlo,
  CcSloGroupStatus,
  CcSloHealth,
  CcSloTier,
  CcSloView,
} from "@/data/cc/types";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/slos_/$sloId",
)({
  // This detail route is flat (slos_), so it doesn't inherit the SLOs listing
  // crumb — emit it here so the trail reads Alerts > SLOs > <name>.
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "SLOs", to: "/alerts/slos" },
      { label: match.loaderData?.name ?? "SLO" },
    ],
    // The alerts section hides the global time-range picker; the firing-history
    // feed below reads stored history, so this page opts back in (like the rule
    // detail page).
    hideTimeRangePicker: false,
  },
  loaderDeps: ({ search }) => ({ timeRange: withTimeRange(search).timeRange }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    const [slo] = await Promise.all([
      queryClient.ensureQueryData(ccQueries.slo(params.sloId)),
      queryClient.prefetchQuery(ccQueries.sloStatus(params.sloId)),
      queryClient.prefetchQuery(ccQueries.eventHistory(deps.timeRange)),
    ]);
    // Prefetch the budget history; skipped for a spec whose window doesn't parse
    // (nothing to chart a trailing window over).
    if (ccSloWindowSecs(slo.spec) !== null) {
      await queryClient.prefetchQuery(
        ccQueries.sloBudgetSeries(slo.id, deps.timeRange),
      );
    }
    return { name: slo.name };
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

// A collapsed-by-default plain-language primer on the four concepts this page
// leans on. Discoverable for a newcomer, one line out of the way for everyone
// else. Kept in step with the in-hero glosses and verdict copy.
function SloPrimer() {
  const [open, setOpen] = useState(false);
  const terms: Array<{ term: string; gloss: string }> = [
    {
      term: "SLO: the promise",
      gloss:
        '"99% of requests succeed over the last 7 days." A realistic target, not "zero errors".',
    },
    {
      term: "Error budget: how much you may fail",
      gloss:
        "The leftover (here, the other 1%). Full means room to spare; 0% means the promise is broken for this window.",
    },
    {
      term: "Burn rate: how fast you spend it",
      gloss:
        "1× is the sustainable pace; 14× means the whole budget would be gone in hours. This is what pages you.",
    },
    {
      term: "Window: the rolling period",
      gloss:
        "Everything is measured over a moving span (e.g. 7 days). Old failures age out, so the budget recovers on its own.",
    },
  ];
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CcDisclosureTrigger open={open}>
        <span className="text-xs font-medium">New to SLOs?</span>
        {!open && (
          <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
            error budget, burn rate, and window in plain words
          </span>
        )}
      </CcDisclosureTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid gap-2.5 rounded-md bg-muted/40 p-3 text-xs ring-1 ring-foreground/10 sm:grid-cols-2">
          {terms.map(({ term, gloss }) => (
            <div key={term} className="space-y-0.5">
              <dt className="font-medium">{term}</dt>
              <dd className="text-muted-foreground">{gloss}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
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
      <dd className="font-mono text-xs">{children}</dd>
    </div>
  );
}

// Fraction/burn formatting is shared with the listing and overview surfaces
// (ccFmtFraction / ccFmtBurn from budget-bar.tsx).

// The two alert outcomes, foregrounded over the raw tiers: the critical tiers
// page, the warning tier tickets. Order = urgency (page before ticket).
const ALERT_OUTCOMES: {
  label: string;
  severity: CcSloTier["severity"];
  blurb: string;
}[] = [
  {
    label: "Pages you",
    severity: "critical",
    blurb: "budget draining fast enough to wake someone",
  },
  {
    label: "Opens a ticket",
    severity: "warning",
    blurb: "a slow leak worth fixing, not tonight",
  },
];

// ── What is it ────────────────────────────────────────────────────────────────

function ObjectiveSection({ slo }: { slo: CcSlo }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);
  const tiers = CC_CANONICAL_SLO_TIERS;
  const ann = slo.spec.annotations;
  // Surface the as-code identity fields natively instead of behind a YAML dump.
  // `everr.project` and `everr.label.*` fold into first-class fields (as they do
  // in the applied document); `description`/`summary` lead the status hero; the
  // rest of the everr.* internals stay hidden. What's left is the author's own
  // pass-through annotations, shown raw.
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
        <CardTitle>Objective</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="divide-y divide-border/60">
          <DefRow label="Target">
            {ccFormatSloTarget(slo.spec.targetPercent)}
          </DefRow>
          <DefRow label="Window">{ccSloWindowLabel(slo.spec)}</DefRow>
          {slo.spec.min_valid_events !== undefined && (
            <DefRow label="Min valid events">
              {slo.spec.min_valid_events}
            </DefRow>
          )}
          <DefRow label="SLI groups by">
            {slo.spec.sli.label_columns.join(", ") || "— (scalar SLI)"}
          </DefRow>
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
        </dl>

        {/* What alerts, framed by outcome rather than by tier: the two critical
            tiers page, the warning tier tickets. The hero's "what would page you"
            carries the live view; this is the static reference, folded by default.
            Tiers are the fixed canonical set (not user-configurable). */}
        <Collapsible open={tiersOpen} onOpenChange={setTiersOpen}>
          <CcDisclosureTrigger open={tiersOpen}>
            <span className="text-xs font-medium">When it alerts</span>
            {!tiersOpen && (
              <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                pages on fast or sustained burn, tickets on a slow leak
              </span>
            )}
          </CcDisclosureTrigger>
          <CollapsibleContent>
            <dl className="mt-2 space-y-3">
              {ALERT_OUTCOMES.map(({ label, severity, blurb }) => {
                const rows = tiers.filter((t) => t.severity === severity);
                if (rows.length === 0) return null;
                return (
                  <div key={severity} className="flex flex-col gap-1">
                    <dt className="flex items-baseline gap-2">
                      <CcSeverityBadge severity={severity} />
                      <span className="text-xs font-medium">{label}</span>
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {blurb}
                      </span>
                    </dt>
                    {rows.map((t) => (
                      <dd
                        key={t.name}
                        className="font-mono text-[0.6875rem] text-muted-foreground"
                      >
                        <span className="text-foreground">{t.name}</span> ·{" "}
                        {ccFmtBurn(t.burn_rate)} over {t.long_window} (short{" "}
                        {t.short_window})
                      </dd>
                    ))}
                  </div>
                );
              })}
            </dl>
          </CollapsibleContent>
        </Collapsible>

        {/* Authors have Git; readers get the SLI SQL on demand, not as a wall. */}
        <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
          <CcDisclosureTrigger open={sqlOpen}>
            <span className="text-xs font-medium">SLI SQL</span>
            {!sqlOpen && (
              <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
                {slo.spec.sli.sql}
              </span>
            )}
          </CcDisclosureTrigger>
          <CollapsibleContent>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs ring-1 ring-foreground/10">
              {slo.spec.sli.sql}
            </pre>
          </CollapsibleContent>
        </Collapsible>
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
  const tiers = CC_CANONICAL_SLO_TIERS;

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
        // Tone from real state, not projection: firing tiers set the color;
        // a sub-threshold burn above 1× still reads as "budget shrinking".
        const firingSeverities = g.firing_tiers.map((f) =>
          ccSloTierSeverity(tiers, { slo_tier: f.tier }),
        );
        const tone = firingSeverities.includes("critical")
          ? "font-medium text-destructive"
          : firingSeverities.length > 0
            ? "font-medium text-amber-600 dark:text-amber-400"
            : burn.rate >= 1
              ? "text-foreground"
              : "text-muted-foreground";
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={`font-mono text-xs tabular-nums ${tone}`} />
              }
            >
              {ccFmtBurn(burn.rate)}
              <span className="text-muted-foreground"> / {burn.window}</span>
            </TooltipTrigger>
            <TooltipContent className="space-y-1.5">
              <p className="max-w-56 text-xs">
                Error-budget burn over each tier&rsquo;s windows; 1&times;
                spends exactly the budget over {ccSloWindowLabel(slo.spec)}. A
                tier fires when both its windows exceed its threshold.
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
                          / {t.long_window}
                        </td>
                        <td className="pr-2">
                          {snap?.short_burn_rate != null
                            ? ccFmtBurn(snap.short_burn_rate)
                            : "—"}{" "}
                          / {t.short_window}
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
          {g.time_to_exhaustion_secs === null
            ? "—"
            : g.time_to_exhaustion_secs === 0
              ? "exhausted"
              : ccFormatSloDuration(g.time_to_exhaustion_secs)}
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
    data.payload.groups,
    fresh.data,
    ccSloWindowSecs(slo.spec),
  );
  const worst = ccWorstSloGroup(groups);

  return (
    <div className="space-y-2">
      {/* At-a-glance: the worst group's budget, burn, and per-tier pressure. */}
      <SloStatusHero slo={slo} worst={worst} groupCount={groups.length} />
      {/* The budget is computed at read time: "just now" once the scan lands,
          and the stored snapshot (already in the hero) meanwhile. */}
      <p className="px-1 text-[0.6875rem] text-muted-foreground">
        Error budget {budgetIsFresh ? "computed just now" : "computing"} over
        the last {ccSloWindowLabel(slo.spec)}, against a{" "}
        {ccFormatSloTarget(slo.spec.targetPercent)} target
        {budgetIsFresh ? "." : <>&hellip;</>}
      </p>

      {/* The full per-group breakdown, only when there is more than one group
          to break down — a scalar SLO is fully described by the hero above. */}
      {groups.length > 1 && (
        <Card inset="flush-content">
          <CardHeader>
            <CardTitle>All groups</CardTitle>
            <CardDescription>
              Per-group SLI, error budget, burn rate, and firing tiers.
            </CardDescription>
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
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

// ── How's the budget trending ─────────────────────────────────────────────────

function BudgetHistorySection({ slo }: { slo: CcSloView }) {
  const { timeRange } = Route.useLoaderDeps();
  const hasWindow = ccSloWindowSecs(slo.spec) !== null;
  const series = useQuery({
    ...ccQueries.sloBudgetSeries(slo.id, timeRange),
    enabled: hasWindow,
  });
  // The same fire/resolve transitions the history feed below shows, overlaid on
  // the budget line so a drop lines up with the tier that fired. Scoped to this
  // SLO's handles; non-transition events (deliveries, silences) drop out.
  const events = useQuery({
    ...ccQueries.eventHistory(timeRange),
    enabled: hasWindow,
  });
  const budgetEvents = useMemo<SloBudgetEvent[]>(() => {
    const handles = new Set(ccSloHandles(slo));
    const out: SloBudgetEvent[] = [];
    for (const e of events.data ?? []) {
      if (!handles.has(e.slug)) continue;
      const type = ccEventStatus(e.eventType);
      if (type) out.push({ t: e.timestamp, type });
    }
    return out;
  }, [events.data, slo]);

  // A spec whose window doesn't parse can't be charted; the objective card
  // still states the window, so no error card is owed here.
  if (!hasWindow) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Error budget over time
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="How to read this chart"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                />
              }
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              100% is the full budget, 0% is exhausted. Solid line is measured;
              the faded dashed section is reconstructed from before this SLO
              existed. Blue "applied" marks where the budget started counting,
              red and green bars are alerts firing and resolving, and the line
              stops at the last evaluation.
            </TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardDescription>
          Budget remaining over a trailing {ccSloWindowLabel(slo.spec)} window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series.isError ? (
          <CcQueryError error={series.error} />
        ) : series.isPending ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <SloBudgetChart
            points={series.data}
            epoch={slo.budget_epoch}
            events={budgetEvents}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FiringHistorySection({ slo }: { slo: CcSlo }) {
  // Scoped to this SLO's handles: the stored fire/resolve transitions and
  // deliveries for its burn-rate tiers, over the page's time range. This is the
  // event-level record that complements the budget trend above.
  // hideRuleColumns drops the (constant) source and severity columns, leaving
  // Time / Event / Labels — the tier rides in the labels as `slo_tier`.
  return (
    <AlertEventFeed
      scopeSlug={ccSloHandles(slo)}
      hideRuleColumns
      showTypeLens
    />
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
  const degraded = health.status === "degraded";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Is it healthy</CardTitle>
      </CardHeader>
      <CardContent>
        {degraded ? (
          // Degraded is loud: the SLI query is failing, so the budget
          // numbers above are going stale.
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
        ) : (
          <div className="flex items-center gap-1.5 text-xs">
            <CcHealthBadge status={health.status} />
            <span className="text-muted-foreground">
              · SLI evaluation is running normally
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CcSloDetailPage() {
  const { sloId } = Route.useParams();
  const qc = useQueryClient();
  const slo = useQuery(ccQueries.slo(sloId));

  const toggle = useMutation({
    mutationFn: (paused: boolean) =>
      paused
        ? resumeCcSlo({ data: { sloId } })
        : pauseCcSlo({ data: { sloId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.slo(sloId).queryKey });
      // The SLOs listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ccQueries.slos().queryKey });
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink />
          <h2 className="text-base font-semibold">{s.name}</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {s.id.slice(0, 8)}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {ccFormatSloTarget(s.spec.targetPercent)} over{" "}
            {ccSloWindowLabel(s.spec)}
          </span>
          {s.paused && <Badge variant="secondary">paused</Badge>}
          {s.spec.suppressed && (
            // Evaluates fully but never notifies — worth a loud flag.
            <Badge variant="destructive">suppressed</Badge>
          )}
        </div>
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

      <SloPrimer />
      <StatusSection slo={s} />
      <BudgetHistorySection slo={s} />
      <ObjectiveSection slo={s} />
      <FiringHistorySection slo={s} />
      <HealthSection sloId={s.id} />
    </div>
  );
}
