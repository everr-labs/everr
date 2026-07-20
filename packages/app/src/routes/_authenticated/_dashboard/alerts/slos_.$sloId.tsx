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
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Pause, Play, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
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
import { SloStatusHero } from "@/components/cc/slo-status";
import {
  ANN_LABEL_PREFIX,
  ANN_PROJECT,
  isEverrAnnotationKey,
} from "@/data/alerts/annotations";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloHandles,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus, CcSloHealth } from "@/data/cc/types";

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

// ── What is it ────────────────────────────────────────────────────────────────

function ObjectiveSection({ slo }: { slo: CcSlo }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const tiers = ccSloTiers(slo.spec);
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

        {/* The burn-rate tiers the evaluator alerts on: explicit spec tiers,
            or the canonical fast-burn/slow-burn/ticket trio when unset. */}
        <div className="space-y-1">
          <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Burn-rate tiers{slo.spec.tiers ? "" : " (canonical)"}
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                <th className="py-1 pr-3 font-medium">Tier</th>
                <th className="py-1 pr-3 font-medium">Burn rate over</th>
                <th className="py-1 pr-3 font-medium">Long window</th>
                <th className="py-1 pr-3 font-medium">Short window</th>
                <th className="py-1 font-medium">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {tiers.map((t) => (
                <tr key={t.name}>
                  <td className="py-1.5 pr-3 font-mono">{t.name}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">
                    {ccFmtBurn(t.burn_rate)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{t.long_window}</td>
                  <td className="py-1.5 pr-3 font-mono">{t.short_window}</td>
                  <td className="py-1.5">
                    <CcSeverityBadge severity={t.severity} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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

  const groups = data.payload.groups;
  const worst = ccWorstSloGroup(groups);

  return (
    <div className="space-y-2">
      {/* At-a-glance: the worst group's budget, burn, and per-tier pressure. */}
      <SloStatusHero slo={slo} worst={worst} groupCount={groups.length} />
      <p className="px-1 text-[0.6875rem] text-muted-foreground">
        Snapshot computed{" "}
        <span title={ccFormatTs(data.computed_at)}>
          <RelativeTime timestamp={data.computed_at} />
        </span>{" "}
        against a {ccFormatSloTarget(slo.spec.targetPercent)} target over{" "}
        {ccSloWindowLabel(slo.spec)}.
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

function FiringHistorySection({ slo }: { slo: CcSlo }) {
  // Scoped to this SLO's handles: the stored fire/resolve transitions and
  // deliveries for its burn-rate tiers, over the page's time range. There is
  // no budget-over-time series to chart, so this is the SLO's temporal record.
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

      <StatusSection slo={s} />
      <ObjectiveSection slo={s} />
      <FiringHistorySection slo={s} />
      <HealthSection sloId={s.id} />
    </div>
  );
}
