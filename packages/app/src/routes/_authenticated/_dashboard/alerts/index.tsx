// The alerting landing page: the whole model, live. One pipeline readout
// (watching → firing → muted → notifying) built from real counts teaches how
// alerting fits together while answering "is anything wrong"; below it, the
// facts that need attention, error-budget posture per SLO, and the freshest
// stored events. Every number links to the page where you act on it.
import { Card, CardContent } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { ccEventStatus } from "@/components/cc/alert-event-feed";
import { CcBudgetBar, ccFmtBurn } from "@/components/cc/budget-bar";
import { CcPageIntro } from "@/components/cc/page-intro";
import {
  CcEventStatusBadge,
  CcQueryError,
  CcSloTierBadge,
  CcStatusDot,
  ccErrorMessage,
  ccFormatTs,
} from "@/components/cc/shared";
import {
  ccRuleHandleResolvers,
  ccRuleIdentity,
} from "@/data/alerts/rule-identity";
import { parseResourceName } from "@/data/as-code/identity";
import { ccQueries } from "@/data/cc/queries";
import {
  ccDispatchLabels,
  ccMatchingSilence,
  ccSelectRoutes,
} from "@/data/cc/route-resolution";
import {
  CC_CANONICAL_SLO_TIERS,
  ccFmtWindowLabel,
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloHandleResolver,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus, CcSloTier } from "@/data/cc/types";

// The overview reads a fixed trailing window of stored events (the alerts
// layout hides the global time-range picker).
const OVERVIEW_EVENT_RANGE: TimeRange = { from: "now-24h", to: "now" };
const OVERVIEW_EVENT_LIMIT = 8;

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/")({
  staticData: { breadcrumb: "Overview" },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ccQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(ccQueries.rules()),
      queryClient.prefetchQuery(ccQueries.slos(deps.preview)),
      queryClient.prefetchQuery(ccQueries.routes()),
      queryClient.prefetchQuery(ccQueries.receivers()),
      queryClient.prefetchQuery(ccQueries.silences()),
      queryClient.prefetchQuery(ccQueries.subscriptions()),
      queryClient.prefetchQuery(
        ccQueries.eventHistory(OVERVIEW_EVENT_RANGE, {
          limit: OVERVIEW_EVENT_LIMIT,
        }),
      ),
    ]),
  component: CcOverviewPage,
});

// ── Pipeline readout ──────────────────────────────────────────────────────────
// The concept made visible: four stages an alert actually moves through, each
// a live count and a link to the page where that stage is managed.

function Stage({
  label,
  primary,
  secondary,
  tone,
}: {
  label: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  tone?: "firing" | "degraded";
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <span className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums whitespace-nowrap",
          tone === "firing" && "text-destructive",
        )}
      >
        {primary}
      </span>
      {secondary && (
        <span
          className={cn(
            "text-[0.6875rem] whitespace-nowrap",
            toneText({ tone: tone === "degraded" ? "warning" : "muted" }),
          )}
        >
          {secondary}
        </span>
      )}
    </span>
  );
}

const STAGE_LINK_CLASS =
  "block rounded-md border border-border bg-card outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary";

function StageArrow() {
  return (
    <ChevronRight
      aria-hidden
      className="hidden size-3.5 shrink-0 self-center text-muted-foreground/60 md:block"
    />
  );
}

// ── Attention items ───────────────────────────────────────────────────────────

type Attention = {
  key: string;
  tone: "firing" | "pending" | "degraded";
  text: React.ReactNode;
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  hash?: string;
};

function AttentionRow({ item }: { item: Attention }) {
  return (
    <Link
      to={item.to}
      params={item.params}
      search={item.search}
      hash={item.hash}
      className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
    >
      <CcStatusDot tone={item.tone} pulse={item.tone === "firing"} />
      <span className="min-w-0 flex-1">{item.text}</span>
      <ArrowRight
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground/60"
      />
    </Link>
  );
}

// ── SLO posture ───────────────────────────────────────────────────────────────

function worstGroup(groups: CcSloGroupStatus[]): CcSloGroupStatus | null {
  if (groups.length === 0) return null;
  return groups.reduce((worst, g) =>
    (g.budget_remaining ?? Number.POSITIVE_INFINITY) <
    (worst.budget_remaining ?? Number.POSITIVE_INFINITY)
      ? g
      : worst,
  );
}

function firingTiersOf(
  tiers: readonly CcSloTier[],
  groups: CcSloGroupStatus[],
): { tier: string; severity: string }[] {
  const byName = new Map<string, string>();
  for (const g of groups) {
    for (const f of g.firing_tiers) {
      byName.set(f.tier, ccSloTierSeverity(tiers, { slo_tier: f.tier }));
    }
  }
  return [...byName].map(([tier, severity]) => ({ tier, severity }));
}

function SloPostureRow({
  slo,
  worst,
  firing,
  statusPending,
}: {
  slo: CcSlo;
  worst: CcSloGroupStatus | null;
  firing: { tier: string; severity: string }[];
  statusPending: boolean;
}) {
  const burn = worst
    ? ccSloCurrentBurn(ccSloTiers(slo.spec), worst.tiers)
    : null;
  const identity = ccSloIdentity(slo);
  return (
    <Link
      to="/alerts/slos/$project/$slug"
      params={{ project: identity.project, slug: identity.slug }}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground">
          {identity.name}
        </span>
        <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
          {ccFormatSloTarget(slo.spec.targetPercent)} over{" "}
          {ccSloWindowLabel(slo.spec)}
        </span>
      </span>
      {statusPending ? (
        <Skeleton className="h-4 w-40" />
      ) : worst === null ? (
        <span className="text-xs text-muted-foreground">no snapshot yet</span>
      ) : (
        <>
          {/* A flex row, so the bar's width is set here rather than inside it. */}
          <CcBudgetBar
            remaining={worst.budget_remaining}
            className="w-24 shrink-0"
          />
          <span className="w-20 text-right font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">
            {burn ? (
              <>
                {ccFmtBurn(burn.rate)} / {ccFmtWindowLabel(burn.window)}
              </>
            ) : (
              "—"
            )}
          </span>
        </>
      )}
      {firing.length > 0 && (
        <span className="flex flex-wrap gap-2">
          {firing.map((f) => (
            <CcSloTierBadge key={f.tier} tier={f.tier} severity={f.severity} />
          ))}
        </span>
      )}
    </Link>
  );
}

// ── Section scaffolding ───────────────────────────────────────────────────────

function SectionCard({
  title,
  linkLabel,
  to,
  children,
}: {
  title: string;
  linkLabel: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Card inset="flush-content">
      <CardContent>
        <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
          <h2 className="text-xs font-semibold text-foreground">{title}</h2>
          <Link
            to={to}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            {linkLabel}
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CcOverviewPage() {
  const { preview } = Route.useSearch();
  const alerts = useQuery(ccQueries.alerts(preview));
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos(preview));
  const routes = useQuery(ccQueries.routes());
  const receivers = useQuery(ccQueries.receivers());
  const silences = useQuery(ccQueries.silences());
  const subscriptions = useQuery(ccQueries.subscriptions());
  const events = useQuery(
    ccQueries.eventHistory(OVERVIEW_EVENT_RANGE, {
      limit: OVERVIEW_EVENT_LIMIT,
    }),
  );
  const slosData = slos.data ?? [];
  const sloStatuses = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
  });

  // On a CC outage every count would render 0 — actively misleading (a false
  // "all clear"). Any errored core query fails the whole page, like Triage.
  const errored = [
    alerts,
    rules,
    slos,
    routes,
    receivers,
    silences,
    subscriptions,
  ].find((query) => query.isError);

  const facts = useMemo(() => {
    const now = Date.now();
    const rulesData = rules.data ?? [];
    const ruleById = new Map(rulesData.map((r) => [r.id, r]));
    const sloById = new Map(slosData.map((s) => [s.id, s]));
    const resolved = (alerts.data ?? []).map((alert) => {
      const slo = alert.slo !== undefined ? sloById.get(alert.slo) : undefined;
      const rule =
        alert.slo === undefined ? ruleById.get(alert.rule) : undefined;
      const labels = ccDispatchLabels(alert, rule, slo);
      return {
        alert,
        rule,
        slo,
        matchedRoutes: ccSelectRoutes(routes.data ?? [], labels),
        silence: ccMatchingSilence(labels, silences.data ?? [], now),
      };
    });
    const firing = resolved.filter((i) => i.alert.status === "firing");
    const active = resolved.filter((i) => i.alert.status !== "inactive");
    const firingSources = new Map<
      string,
      {
        name: string;
        isSlo: boolean;
        sourceId: string;
        count: number;
        severity: string;
        // The rule's slug address, when the rule is still known — absent for
        // an alert whose source rule has since been deleted (a stale handle).
        address: { project: string; slug: string } | null;
      }
    >();
    for (const i of firing.filter((f) => f.silence === null)) {
      const entry = firingSources.get(i.alert.rule) ?? {
        name: i.slo
          ? ccSloIdentity(i.slo).name
          : i.rule
            ? ccRuleIdentity(i.rule).name
            : i.alert.rule.slice(0, 8),
        isSlo: i.alert.slo !== undefined,
        sourceId: i.alert.slo ?? i.alert.rule,
        count: 0,
        severity: i.slo
          ? ccSloTierSeverity(CC_CANONICAL_SLO_TIERS, i.alert.labels)
          : (i.rule?.spec.severity ?? "info"),
        address: i.rule
          ? {
              project: ccRuleIdentity(i.rule).project,
              slug: ccRuleIdentity(i.rule).slug,
            }
          : null,
      };
      entry.count += 1;
      firingSources.set(i.alert.rule, entry);
    }
    return {
      firing: firing.length,
      pendingInstances: resolved.filter((i) => i.alert.status === "pending")
        .length,
      silencedInstances: active.filter((i) => i.silence !== null).length,
      unroutedFiring: firing.filter(
        (i) => i.silence === null && i.matchedRoutes.length === 0,
      ).length,
      firingSources: [...firingSources.values()],
      watchingRules: rulesData.filter((r) => !r.paused).length,
      pausedRules: rulesData.filter((r) => r.paused).length,
      watchingSlos: slosData.filter((s) => !s.paused).length,
      activeSilences: (silences.data ?? []).filter(
        (s) =>
          new Date(s.starts_at).getTime() <= now &&
          now < new Date(s.ends_at).getTime(),
      ).length,
      routeCount: (routes.data ?? []).length,
      receiverCount: (receivers.data ?? []).length,
      subscriberCount: (subscriptions.data ?? []).length,
    };
  }, [
    alerts.data,
    rules.data,
    slosData,
    routes.data,
    silences.data,
    receivers.data,
    subscriptions.data,
  ]);

  const sloPosture = slosData.map((slo, i) => {
    const status = sloStatuses[i];
    const groups = status.data?.payload?.groups ?? [];
    return {
      slo,
      statusPending: status.isPending,
      worst: worstGroup(groups),
      firing: firingTiersOf(CC_CANONICAL_SLO_TIERS, groups),
    };
  });

  const resolveSlo = useMemo(() => ccSloHandleResolver(slosData), [slosData]);
  // Event rows carry a source handle (slug or uuid) for rules and SLOs alike;
  // the shared resolvers map either to a display name.
  const { resolveRuleName, resolveRuleAddress } = useMemo(
    () => ccRuleHandleResolvers(rules.data ?? []),
    [rules.data],
  );

  const attention: Attention[] = [];
  for (const p of sloPosture) {
    const exhausted =
      p.worst !== null &&
      p.worst.budget_remaining !== null &&
      p.worst.budget_remaining <= 0;
    if (p.firing.length === 0 && !exhausted) continue;
    const tte = p.worst?.time_to_exhaustion_secs;
    attention.push({
      key: `slo-${p.slo.id}`,
      tone: p.firing.some((f) => f.severity === "critical")
        ? "firing"
        : p.firing.length > 0
          ? "pending"
          : "firing",
      to: "/alerts/slos/$project/$slug",
      params: parseResourceName(p.slo.name),
      text: (
        <>
          <span className="font-medium text-foreground">
            {ccSloIdentity(p.slo).name}
          </span>{" "}
          {exhausted && p.firing.length === 0 ? (
            <>has exhausted its error budget</>
          ) : (
            <>
              is burning error budget — {p.firing.map((f) => f.tier).join(", ")}{" "}
              firing
              {tte != null && tte > 0 && (
                <>, {ccFormatSloDuration(tte)} to exhaustion</>
              )}
            </>
          )}
        </>
      ),
    });
  }
  for (const src of facts.firingSources.filter((s) => !s.isSlo)) {
    attention.push({
      key: `rule-${src.sourceId}`,
      tone: src.severity === "critical" ? "firing" : "pending",
      // A stale handle (the source rule was deleted since) has no address to
      // link to; fall back to the rules list rather than a dead link.
      ...(src.address
        ? { to: "/alerts/rules/$project/$slug", params: src.address }
        : { to: "/alerts/rules" }),
      text: (
        <>
          <span className="font-medium text-foreground">{src.name}</span> is
          firing — {src.count} {src.count === 1 ? "instance" : "instances"},{" "}
          {src.severity}
        </>
      ),
    });
  }
  if (facts.unroutedFiring > 0) {
    attention.push({
      key: "unrouted",
      tone: "degraded",
      to: "/alerts/delivery",
      hash: "firehose",
      text: (
        <>
          <span className="font-medium text-foreground">
            {facts.unroutedFiring} firing{" "}
            {facts.unroutedFiring === 1 ? "instance" : "instances"}
          </span>{" "}
          match no route —{" "}
          {facts.subscriberCount > 0
            ? "delivery falls through to the firehose"
            : "and the firehose has no subscribers, so nobody is told"}
        </>
      ),
    });
  }

  if (errored) return <CcQueryError error={errored.error} />;

  const pending =
    alerts.isPending ||
    rules.isPending ||
    slos.isPending ||
    routes.isPending ||
    receivers.isPending ||
    silences.isPending ||
    subscriptions.isPending;

  const lastEventTs = events.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Alerting"
        lede="Rules and SLOs watch your telemetry; what they catch flows through routes to the people who need to know. This is the live picture."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />

      {/* The pipeline: four live stages, each linking to its page. */}
      {pending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : (
        <nav
          aria-label="Alerting pipeline"
          className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:gap-2"
        >
          <Link to="/alerts/rules" className={STAGE_LINK_CLASS}>
            <Stage
              label="Watching"
              primary={
                <>
                  {facts.watchingRules}{" "}
                  {facts.watchingRules === 1 ? "rule" : "rules"} ·{" "}
                  {facts.watchingSlos}{" "}
                  {facts.watchingSlos === 1 ? "SLO" : "SLOs"}
                </>
              }
              secondary={
                facts.pausedRules > 0
                  ? `${facts.pausedRules} paused`
                  : "none paused"
              }
            />
          </Link>
          <StageArrow />
          <Link to="/alerts/triage" className={STAGE_LINK_CLASS}>
            <Stage
              label="Firing"
              primary={facts.firing}
              secondary={
                facts.pendingInstances > 0
                  ? `${facts.pendingInstances} pending`
                  : facts.firing > 0
                    ? "needs attention"
                    : "all quiet"
              }
              tone={facts.firing > 0 ? "firing" : undefined}
            />
          </Link>
          <StageArrow />
          <Link
            to="/alerts/triage"
            hash="silences"
            className={STAGE_LINK_CLASS}
          >
            <Stage
              label="Silenced"
              primary={facts.silencedInstances}
              secondary={`${facts.activeSilences} active ${
                facts.activeSilences === 1 ? "silence" : "silences"
              }`}
            />
          </Link>
          <StageArrow />
          <Link to="/alerts/delivery" className={STAGE_LINK_CLASS}>
            <Stage
              label="Notifying"
              primary={
                <>
                  {facts.routeCount}{" "}
                  {facts.routeCount === 1 ? "route" : "routes"} →{" "}
                  {facts.receiverCount}{" "}
                  {facts.receiverCount === 1 ? "receiver" : "receivers"}
                </>
              }
              secondary={
                facts.unroutedFiring > 0
                  ? `${facts.unroutedFiring} firing unrouted`
                  : facts.routeCount === 0
                    ? "firehose only"
                    : "routes matching"
              }
              tone={facts.unroutedFiring > 0 ? "degraded" : undefined}
            />
          </Link>
        </nav>
      )}

      {/* What deserves a human: firing sources, burning budgets, degraded
          rules, delivery gaps — or a quiet, honest all-clear. */}
      <Card inset="flush-content">
        <CardContent>
          {pending ? (
            <div className="space-y-2 px-3 py-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : attention.length > 0 ? (
            <div className="divide-y divide-border/60">
              {attention.map((item) => (
                <AttentionRow key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <CcStatusDot tone="healthy" />
                All clear
              </span>
              <span className="text-muted-foreground tabular-nums">
                {facts.watchingRules + facts.watchingSlos} sources watching
                {lastEventTs ? (
                  <>
                    {" · last event "}
                    <RelativeTime timestamp={lastEventTs} />
                  </>
                ) : (
                  " · no events in the last 24h"
                )}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-3 lg:grid-cols-5">
        {/* Error budget posture, worst group per SLO. */}
        <div className="lg:col-span-3">
          <SectionCard
            title="Error budgets"
            linkLabel="All SLOs"
            to="/alerts/slos"
          >
            {slos.isPending ? (
              <div className="space-y-2 px-3 py-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : sloPosture.length === 0 ? (
              <p className="px-3 pt-1 pb-3 text-xs text-muted-foreground">
                No SLOs yet. Define one as code — an SLI query, a target, a
                window — and apply it with{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
                  everr apply
                </code>
                ; its error budget shows up here.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {sloPosture.map((p) => (
                  <SloPostureRow
                    key={p.slo.id}
                    slo={p.slo}
                    worst={p.worst}
                    firing={p.firing}
                    statusPending={p.statusPending}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* The freshest stored events, so "what just happened" is one glance
            (and History is one click) away. */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Recent events"
            linkLabel="History"
            to="/alerts/history"
          >
            {events.isPending ? (
              <div className="space-y-2 px-3 py-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : events.isError ? (
              // A failed history read is not "no events": saying so would be
              // a false all-clear on the overview.
              <p className="px-3 pt-1 pb-3 text-xs text-destructive">
                Event history unavailable ({ccErrorMessage(events.error)}).
              </p>
            ) : (events.data ?? []).length === 0 ? (
              <p className="px-3 pt-1 pb-3 text-xs text-muted-foreground">
                No stored events in the last 24h.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {(events.data ?? []).map((e) => {
                  const status = ccEventStatus(e.eventType);
                  const slo = resolveSlo(e.slug);
                  const ruleAddress = slo
                    ? undefined
                    : resolveRuleAddress(e.slug);
                  const name = slo
                    ? ccSloIdentity(slo).name
                    : resolveRuleName(e.slug);
                  return (
                    <li
                      key={`${e.timestamp}-${e.eventType}-${e.instanceFingerprint}`}
                      className="flex items-center gap-2.5 px-3 py-1.5 text-xs"
                    >
                      <span
                        className="w-16 shrink-0 text-muted-foreground tabular-nums"
                        title={ccFormatTs(e.timestamp)}
                      >
                        <RelativeTime timestamp={e.timestamp} />
                      </span>
                      <span className="w-20 shrink-0">
                        {status !== null ? (
                          <CcEventStatusBadge status={status} />
                        ) : (
                          <span className="text-muted-foreground">
                            {e.eventType.replace("_", " ")}
                          </span>
                        )}
                      </span>
                      {/* A resolved source links to where you act on it — the
                          feed's contract with the rest of the page. */}
                      {slo ? (
                        <Link
                          to="/alerts/slos/$project/$slug"
                          params={parseResourceName(slo.name)}
                          className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                        >
                          {name}
                        </Link>
                      ) : ruleAddress ? (
                        <Link
                          to="/alerts/rules/$project/$slug"
                          params={ruleAddress}
                          className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {name}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
