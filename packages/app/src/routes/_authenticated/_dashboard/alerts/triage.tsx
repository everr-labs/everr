import { Button, buttonVariants } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BellOff, BookOpenText, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ccEventStatus } from "@/components/cc/alert-event-feed";
import {
  CcEmptyState,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSegmentedControl,
  CcSeverityBadge,
  CcSloTierBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
  EvidenceChips,
  LabelSet,
  Pill,
} from "@/components/cc/shared";
import { fromCcRuleSpec } from "@/data/alerts/mapping";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import {
  ccDispatchLabels,
  ccMatchingSilence,
  ccSelectRoutes,
} from "@/data/cc/route-resolution";
import { createCcSilence } from "@/data/cc/server";
import { ccSloTierSeverity, ccSloTiers } from "@/data/cc/slo";
import type {
  CcAlert,
  CcMatcher,
  CcRoute,
  CcRuleView,
  CcSilence,
  CcSlo,
} from "@/data/cc/types";
import type { SilenceHandoff } from "./silences";

// The alerts layout hides the global time-range picker, so Triage reads a
// fixed trailing window of stored events for evidence and recent transitions.
const TRIAGE_EVENT_RANGE: TimeRange = { from: "now-24h", to: "now" };
// Per-instance cap for the expanded row's fingerprint-scoped feed: it needs
// the newest evidence-carrying event plus the last 6 transitions, so this is
// generous headroom.
const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

// The board itself only needs the timestamp of the newest stored event (the
// all-clear freshness readout), so it polls a limit-1 query; each expanded
// row fetches and polls its own fingerprint-scoped events instead of the
// whole 24h window.
const latestEventQuery = () =>
  ccQueries.eventHistory(TRIAGE_EVENT_RANGE, { limit: 1 });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/triage",
)({
  staticData: { breadcrumb: "Triage" },
  head: () => ({ meta: [{ title: "Everr - Alerts Triage" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(ccQueries.alerts()),
      queryClient.prefetchQuery(ccQueries.rules()),
      queryClient.prefetchQuery(ccQueries.slos()),
      queryClient.prefetchQuery(ccQueries.routes()),
      queryClient.prefetchQuery(ccQueries.receivers()),
      queryClient.prefetchQuery(ccQueries.silences()),
      queryClient.prefetchQuery(ccQueries.subscriptions()),
      queryClient.prefetchQuery(latestEventQuery()),
    ]),
  component: CcTriagePage,
});

// ── Vocabulary helpers ────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const STATUS_RANK: Record<string, number> = {
  firing: 0,
  pending: 1,
  inactive: 2,
};

function ruleDisplayName(rule: CcRuleView | undefined, ruleId: string): string {
  return rule ? ccRuleIdentity(rule).name : ruleId.slice(0, 8);
}

/** /runbooks/$project/$slug params when the rule links a runbook, else null. */
function runbookParams(
  rule: CcRuleView | undefined,
): { project: string; slug: string } | null {
  return rule ? ccRuleIdentity(rule).runbook : null;
}

/**
 * The matchers a silence created from this instance carries: every instance
 * label pinned with `eq`, plus a synthetic scoping label — `slo` for
 * SLO-sourced instances, `rule` otherwise (the dispatcher matches silences
 * against synthetic labels, so a label-free source still gets a working,
 * precisely scoped silence).
 */
function sourceScopedSilenceMatchers(alert: CcAlert): CcMatcher[] {
  return [
    ...Object.entries(alert.labels).map(([label, value]) => ({
      label,
      op: "eq" as const,
      value,
    })),
    alert.slo !== undefined
      ? { label: "slo", op: "eq" as const, value: alert.slo }
      : { label: "rule", op: "eq" as const, value: alert.rule },
  ];
}

// One triage row: the instance plus every fact the board derives for it.
// `rule` and `slo` are mutually exclusive resolutions of the instance's
// source (alert.slo discriminates).
type TriageInstance = {
  alert: CcAlert;
  rule: CcRuleView | undefined;
  slo: CcSlo | undefined;
  matchedRoutes: CcRoute[];
  silence: CcSilence | null;
};

/** The severity an SLO-sourced instance fires at: its tier's severity. */
function sloInstanceSeverity(slo: CcSlo, alert: CcAlert) {
  return ccSloTierSeverity(ccSloTiers(slo.spec), alert.labels);
}

// ── Instrument strip ──────────────────────────────────────────────────────────

function StripCell({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone?: "firing" | "degraded";
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 py-2">
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "firing" && value > 0
            ? "text-destructive"
            : tone === "degraded" && value > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {hint && <span className="text-[0.625rem] text-destructive">{hint}</span>}
    </div>
  );
}

// ── Delivery fact ─────────────────────────────────────────────────────────────

function DeliveryFact({
  matchedRoutes,
  channelsByReceiver,
  hasSubscribers,
}: {
  matchedRoutes: CcRoute[];
  channelsByReceiver: Map<string, string[]>;
  hasSubscribers: boolean;
}) {
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="firehose"
        onClick={(e) => e.stopPropagation()}
        className="whitespace-nowrap text-xs text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
      >
        {hasSubscribers
          ? "not routed · firehose only"
          : "not routed · no subscribers"}
      </Link>
    );
  }
  const receiverNames = [...new Set(matchedRoutes.map((r) => r.receiver))];
  const channels = [
    ...new Set(receiverNames.flatMap((n) => channelsByReceiver.get(n) ?? [])),
  ];
  return (
    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
      <span aria-hidden>→ </span>
      <span className="text-foreground">{receiverNames.join(", ")}</span>
      {channels.length > 0 && <> · {channels.join(", ")}</>}
    </span>
  );
}

// ── Row expansion ─────────────────────────────────────────────────────────────

function InstanceDetail({
  inst,
  onSilence,
  silencePending,
  onCustomSilence,
}: {
  inst: TriageInstance;
  onSilence: (hours: number) => void;
  silencePending: boolean;
  onCustomSilence: () => void;
}) {
  const { alert, rule } = inst;
  // This instance's own stored events, fetched (and polled) only while the
  // row is expanded — the fingerprint narrows server-side, so the board never
  // ships the whole 24h window for one row's detail.
  const ownEvents = useQuery(
    ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      fingerprint: alert.key,
      limit: TRIAGE_INSTANCE_EVENT_LIMIT,
    }),
  );
  const own = ownEvents.data ?? [];
  const latest = own.find(
    (e) => e.evidence && Object.keys(e.evidence).length > 0,
  );
  const transitions = own
    .filter((e) => ccEventStatus(e.eventType) !== null)
    .slice(0, 6);
  const runbook = runbookParams(rule);
  const description = rule
    ? fromCcRuleSpec(rule.spec).displayDescription
    : null;

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-3 pl-9">
      {description && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {latest?.evidence && (
        <div className="space-y-1">
          <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Evidence
          </div>
          <EvidenceChips
            evidence={latest.evidence}
            truncated={latest.evidenceTruncated}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Route
        </div>
        {inst.matchedRoutes.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no route matches — delivery falls through to the firehose
          </span>
        ) : (
          <div className="space-y-1">
            {inst.matchedRoutes.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-foreground">
                  {r.receiver}
                </span>
                <Conditions matchers={r.matchers} emptyLabel="* (catch-all)" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Recent transitions
        </div>
        {ownEvents.isPending ? (
          <Skeleton className="h-4 w-44" />
        ) : transitions.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no stored transitions in the last 24h
          </span>
        ) : (
          <ul className="space-y-0.5">
            {transitions.map((e) => (
              <li
                key={`${e.timestamp}-${e.eventType}`}
                className="flex items-center gap-2 text-xs tabular-nums"
              >
                <CcStatusDot
                  tone={
                    ccEventStatus(e.eventType) === "firing"
                      ? "firing"
                      : "resolved"
                  }
                />
                <span className="w-14 text-muted-foreground">
                  {ccEventStatus(e.eventType) ?? e.eventType}
                </span>
                <RelativeTime
                  timestamp={e.timestamp}
                  className="text-muted-foreground/80"
                  title={ccFormatTs(e.timestamp)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          last seen{" "}
          {alert.last_seen ? <RelativeTime timestamp={alert.last_seen} /> : "—"}
        </span>
        {alert.absent_count > 0 && <span>absent x{alert.absent_count}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="pr-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Silence
        </span>
        {[1, 8, 24].map((h) => (
          <Button
            key={h}
            variant="outline"
            size="sm"
            disabled={silencePending}
            onClick={() => onSilence(h)}
          >
            {h}h
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={silencePending}
          onClick={onCustomSilence}
        >
          Custom
        </Button>
        {runbook && (
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <BookOpenText data-icon="inline-start" />
            Runbook
          </Link>
        )}
      </div>
    </div>
  );
}

function InstanceRow({
  inst,
  expanded,
  onToggle,
  deliveryFact,
  children,
}: {
  inst: TriageInstance;
  expanded: boolean;
  onToggle: () => void;
  deliveryFact: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { alert, silence } = inst;
  const muted = alert.status !== "firing";
  // SLO-sourced rows surface the burn-rate tier as a first-class badge (toned
  // by the severity the tier fires at) instead of leaving it buried in the
  // label pills.
  const tier = inst.slo !== undefined ? alert.labels.slo_tier : undefined;
  const shownLabels =
    tier === undefined
      ? alert.labels
      : Object.fromEntries(
          Object.entries(alert.labels).filter(([k]) => k !== "slo_tier"),
        );
  return (
    <div className={cn(muted && "opacity-60")}>
      {/* Mouse convenience on the row; the chevron button is the keyboard and
          screen-reader target (same split as DataTable's onRowClick idiom). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard target */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse convenience only */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button") !== null) return;
          onToggle();
        }}
        className="flex cursor-pointer items-center gap-3 px-3 py-1.5 transition-colors duration-150 hover:bg-muted/40"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse instance" : "Expand instance"}
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>
        <span className="w-16 shrink-0 text-xs">
          <CcInstanceStatusBadge status={alert.status} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tier !== undefined && inst.slo !== undefined && (
            <CcSloTierBadge
              tier={tier}
              severity={sloInstanceSeverity(inst.slo, alert)}
            />
          )}
          {/* A scalar SLO instance's only label is the tier, already shown as
              the badge — don't append a "no labels" placeholder after it. */}
          {(tier === undefined || Object.keys(shownLabels).length > 0) && (
            <LabelSet labels={shownLabels} emptyLabel="no labels" />
          )}
        </span>
        <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
          {alert.value ?? "—"}
        </span>
        <span
          className="w-24 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground"
          title={ccFormatTs(alert.active_since)}
        >
          {alert.active_since ? (
            <RelativeTime timestamp={alert.active_since} />
          ) : (
            "—"
          )}
        </span>
        <span className="flex w-56 shrink-0 items-center justify-end gap-2">
          {silence && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={[silence.comment, `until ${ccFormatTs(silence.ends_at)}`]
                .filter(Boolean)
                .join(" · ")}
            >
              <BellOff className="size-3" />
              silenced
            </span>
          )}
          {deliveryFact}
        </span>
      </div>
      {expanded && children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LENSES = [
  { key: "firing", label: "Firing" },
  { key: "silenced", label: "Silenced" },
  { key: "all", label: "All" },
] as const;
type LensKey = (typeof LENSES)[number]["key"];

function CcTriagePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alerts = useQuery(ccQueries.alerts());
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos());
  const routes = useQuery(ccQueries.routes());
  const receivers = useQuery(ccQueries.receivers());
  const silences = useQuery(ccQueries.silences());
  const subscriptions = useQuery(ccQueries.subscriptions());
  const latestEvent = useQuery(latestEventQuery());

  const [lens, setLens] = useState<LensKey>("firing");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const silenceInstance = useMutation({
    mutationFn: ({ alert, hours }: { alert: CcAlert; hours: number }) =>
      createCcSilence({
        data: {
          matchers: sourceScopedSilenceMatchers(alert),
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      }),
    onSuccess: (_, { hours }) => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      toast.success(`Silenced for ${hours}h`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  // On a CC outage every count would render 0 — actively misleading (a false
  // "all clear"). Any errored core query fails the whole page to the shared
  // "alerting service unavailable" card, matching the sibling pages.
  const errored = [
    alerts,
    rules,
    slos,
    routes,
    receivers,
    silences,
    subscriptions,
  ].find((query) => query.isError);

  const ruleById = useMemo(
    () => new Map((rules.data ?? []).map((r) => [r.id, r])),
    [rules.data],
  );
  const sloById = useMemo(
    () => new Map((slos.data ?? []).map((s) => [s.id, s])),
    [slos.data],
  );
  const channelsByReceiver = useMemo(
    () => new Map((receivers.data ?? []).map((r) => [r.name, r.channels])),
    [receivers.data],
  );

  // Every derived fact for every instance, resolved once with the engine's own
  // matching semantics (synthetic labels, priority + continue routes).
  // Date.now() is read inside the memo: silence-window staleness is bounded by
  // the 15s poll cycling alerts/silences data.
  const instances: TriageInstance[] = useMemo(() => {
    const now = Date.now();
    return (alerts.data ?? []).map((alert) => {
      // `alert.rule` carries the source uuid for SLO rows too (CC's wire
      // convention); `alert.slo` discriminates, so exactly one side resolves.
      const slo = alert.slo !== undefined ? sloById.get(alert.slo) : undefined;
      const rule =
        alert.slo === undefined ? ruleById.get(alert.rule) : undefined;
      const matchLabels = ccDispatchLabels(alert, rule, slo);
      return {
        alert,
        rule,
        slo,
        matchedRoutes: ccSelectRoutes(routes.data ?? [], matchLabels),
        silence: ccMatchingSilence(matchLabels, silences.data ?? [], now),
      };
    });
  }, [alerts.data, ruleById, sloById, routes.data, silences.data]);

  // Stable identities for `visible` and the counts so the `groups` memo below
  // only recomputes when the underlying facts or the lens change.
  const { visible, counts } = useMemo(() => {
    const now = Date.now();
    const active = instances.filter((i) => i.alert.status !== "inactive");
    return {
      counts: {
        firing: instances.filter((i) => i.alert.status === "firing").length,
        silenced: active.filter((i) => i.silence !== null).length,
        degradedRules: (rules.data ?? []).filter(
          (r) => r.health.status === "degraded",
        ).length,
        activeSilences: (silences.data ?? []).filter(
          (s) =>
            new Date(s.starts_at).getTime() <= now &&
            now < new Date(s.ends_at).getTime(),
        ).length,
      },
      visible:
        lens === "firing"
          ? active.filter((i) => i.silence === null)
          : lens === "silenced"
            ? active.filter((i) => i.silence !== null)
            : instances,
    };
  }, [instances, lens, rules.data, silences.data]);

  // Group by source (rule or SLO — `alert.rule` carries the uuid for both),
  // severity-sorted (critical → warning → info), then by name; within a group
  // firing instances precede pending (muted) and inactive. An SLO group's
  // severity is the highest tier severity among its visible instances (each
  // burn-rate instance fires at its own tier's severity).
  const groups = useMemo(() => {
    const bySource = new Map<string, TriageInstance[]>();
    for (const inst of visible) {
      const list = bySource.get(inst.alert.rule) ?? [];
      list.push(inst);
      bySource.set(inst.alert.rule, list);
    }
    return [...bySource.entries()]
      .map(([sourceId, list]) => {
        const slo = list[0].slo;
        // The instance knows it is SLO-sourced even before the SLO listing
        // resolves the object, so linking/marking never falls back to a rule.
        const sloId = list[0].alert.slo;
        const severity = slo
          ? list.reduce((top: string, inst) => {
              const s = sloInstanceSeverity(slo, inst.alert);
              return (SEVERITY_RANK[s] ?? 3) < (SEVERITY_RANK[top] ?? 3)
                ? s
                : top;
            }, "info" as string)
          : (list[0].rule?.spec.severity ?? "info");
        return {
          sourceId,
          rule: list[0].rule,
          slo,
          sloId,
          name: slo
            ? slo.name
            : sloId !== undefined
              ? sloId.slice(0, 8)
              : ruleDisplayName(list[0].rule, sourceId),
          severity,
          instances: [...list].sort(
            (a, b) =>
              (STATUS_RANK[a.alert.status] ?? 3) -
                (STATUS_RANK[b.alert.status] ?? 3) ||
              (a.alert.active_since ?? "").localeCompare(
                b.alert.active_since ?? "",
              ),
          ),
        };
      })
      .sort(
        (a, b) =>
          (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
          a.name.localeCompare(b.name),
      );
  }, [visible]);

  if (errored) return <CcQueryError error={errored.error} />;

  const pending =
    alerts.isPending ||
    rules.isPending ||
    slos.isPending ||
    routes.isPending ||
    receivers.isPending ||
    silences.isPending ||
    subscriptions.isPending;

  const hasSubscribers = (subscriptions.data ?? []).length > 0;
  const watching = (rules.data ?? []).filter((r) => !r.paused).length;
  const lastEventTs = latestEvent.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      {/* Instrument strip: the four numbers that answer "is anything wrong".
          Gated on load — zeros while fetching would read as a false all-clear. */}
      {pending ? (
        <Skeleton className="h-9 w-full rounded-md" />
      ) : (
        <section
          aria-label="Alerting status"
          className="flex flex-wrap items-center divide-x divide-border/60 rounded-md border border-border bg-card"
        >
          <StripCell
            label="firing"
            value={counts.firing}
            tone="firing"
            hint={counts.firing > 0 ? "needs attention" : undefined}
          />
          <StripCell label="silenced" value={counts.silenced} />
          {counts.degradedRules > 0 && (
            <Link
              to="/alerts/rules"
              search={{ health: "degraded" }}
              className="outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
            >
              <StripCell
                label="degraded rules"
                value={counts.degradedRules}
                tone="degraded"
              />
            </Link>
          )}
          <Link
            to="/alerts/silences"
            className="outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary"
          >
            <StripCell label="active silences" value={counts.activeSilences} />
          </Link>
        </section>
      )}

      <CcSegmentedControl
        items={LENSES}
        value={lens}
        onChange={setLens}
        aria-label="Triage lens"
      />

      <Card inset="flush-content">
        <CardContent>
          {pending ? (
            <CcTableSkeleton rows={6} />
          ) : groups.length === 0 ? (
            lens === "firing" ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <CcStatusDot tone="healthy" />
                  All clear
                </span>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {watching} {watching === 1 ? "rule" : "rules"} watching
                  {lastEventTs ? (
                    <>
                      {" · last event "}
                      <RelativeTime timestamp={lastEventTs} />
                    </>
                  ) : (
                    " · no events in the last 24h"
                  )}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Firing instances appear here the moment a rule&rsquo;s query
                  returns rows.
                </p>
              </div>
            ) : (
              <CcEmptyState
                icon={BellOff}
                title={
                  lens === "silenced"
                    ? "No silenced instances"
                    : "No alert instances"
                }
                hint={
                  lens === "silenced"
                    ? "Instances matched by an active silence appear here."
                    : "Active rules surface instances here as they evaluate."
                }
              />
            )
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map((group) => (
                <section key={group.sourceId} className="py-1">
                  <div className="flex items-center gap-2.5 px-3 py-1.5">
                    {group.sloId !== undefined ? (
                      <Link
                        to="/alerts/slos/$sloId"
                        params={{ sloId: group.sloId }}
                        className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {group.name}
                      </Link>
                    ) : (
                      <Link
                        to="/alerts/rules/$ruleId"
                        params={{ ruleId: group.sourceId }}
                        className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {group.name}
                      </Link>
                    )}
                    {group.sloId !== undefined && (
                      // Origin marker: this group is an SLO's burn-rate
                      // alerting, not a rule's.
                      <Pill className="text-muted-foreground">SLO</Pill>
                    )}
                    <CcSeverityBadge severity={group.severity} />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {group.instances.length}{" "}
                      {group.instances.length === 1 ? "instance" : "instances"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 px-3 pb-0.5 text-[0.625rem] font-medium tracking-wide text-muted-foreground/70 uppercase">
                    <span className="size-5 shrink-0" />
                    <span className="w-16 shrink-0" />
                    <span className="min-w-0 flex-1" />
                    <span className="w-16 shrink-0 text-right">
                      {group.sloId !== undefined
                        ? "burn rate"
                        : group.rule?.spec.value_column || "value"}
                    </span>
                    <span className="w-24 shrink-0" />
                    <span className="w-56 shrink-0" />
                  </div>
                  {group.instances.map((inst) => (
                    <InstanceRow
                      key={inst.alert.key}
                      inst={inst}
                      expanded={expandedKey === inst.alert.key}
                      onToggle={() =>
                        setExpandedKey((k) =>
                          k === inst.alert.key ? null : inst.alert.key,
                        )
                      }
                      deliveryFact={
                        <DeliveryFact
                          matchedRoutes={inst.matchedRoutes}
                          channelsByReceiver={channelsByReceiver}
                          hasSubscribers={hasSubscribers}
                        />
                      }
                    >
                      <InstanceDetail
                        inst={inst}
                        silencePending={silenceInstance.isPending}
                        onSilence={(hours) =>
                          silenceInstance.mutate({ alert: inst.alert, hours })
                        }
                        onCustomSilence={() =>
                          navigate({
                            to: "/alerts/silences",
                            // TanStack Router's history state is untyped
                            // without global augmentation, hence the cast; the
                            // shared SilenceHandoff type keeps both sides of
                            // the handoff agreeing on the shape.
                            state: {
                              silencePrefill: sourceScopedSilenceMatchers(
                                inst.alert,
                              ),
                            } satisfies SilenceHandoff as never,
                          })
                        }
                      />
                    </InstanceRow>
                  ))}
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
