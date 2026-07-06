import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import * as cc from "@/data/cc/client";
import type {
  CcMatcher,
  CcRuleSpec,
  CcRuleView,
  CcSilence,
} from "@/data/cc/types";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";
import { getPreviewRegistry } from "@/data/previews/repoids";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_SLACK_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
  DeliverySettingsSchema,
  normalizeDeliverySettings,
  receiversToDeliverySettings,
} from "./delivery-settings";
import {
  ANN_CC_LINK_ALERT,
  fromCcRuleSpec,
  isOwnedRule,
  OWN_PREVIEW,
  OWN_REPO,
  previewIdOf,
} from "./mapping";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  validateMatchers,
} from "./matchers";

// A simple alert's silences are scoped to the rule by a synthetic `rule` label
// carrying the rule's id (CC does not stamp the slug as a label, so an
// `alertname` matcher never matches). The create path writes this matcher; the
// list/count paths filter on it; the UI never sees it. Exported so other
// client-facing views (e.g. the alerts list's org-wide mutes panel, which
// reads raw CC silences directly) can filter it out too.
export const RULE_LABEL = "rule";

const CC_OP_TO_UI: Record<CcMatcher["op"], Matcher["op"]> = {
  eq: "=",
  ne: "!=",
  regex: "=~",
  notregex: "!~",
};
const UI_OP_TO_CC: Record<Matcher["op"], CcMatcher["op"]> = {
  "=": "eq",
  "!=": "ne",
  "=~": "regex",
  "!~": "notregex",
};

function ccToUiMatchers(ms: CcMatcher[]): Matcher[] {
  return ms.map((m) => ({
    label: m.label,
    op: CC_OP_TO_UI[m.op],
    value: m.value,
  }));
}

// A silence belongs to this rule when it carries the synthetic rule matcher.
function silenceScopedToRule(s: CcSilence, ruleId: string): boolean {
  return s.matchers.some(
    (m) => m.label === RULE_LABEL && m.op === "eq" && m.value === ruleId,
  );
}

type ActiveSilenceInfo = {
  activeSilenceCount: number;
  // ISO of the latest end among the active silences — when the alert un-mutes.
  activeSilenceExpiresAt: string | null;
};

// Count only this rule's silences that are currently in their active window
// (started, not yet ended) and report when the alert un-silences: the latest
// end among them (overlapping silences keep it muted until the last one lifts).
function activeSilencesForRule(
  silences: CcSilence[],
  ruleId: string,
  now: number = Date.now(),
): ActiveSilenceInfo {
  let count = 0;
  let maxEnds: number | null = null;
  for (const s of silences) {
    if (!silenceScopedToRule(s, ruleId)) continue;
    const starts = new Date(s.starts_at).getTime();
    const ends = new Date(s.ends_at).getTime();
    if (Number.isNaN(starts) || Number.isNaN(ends)) continue;
    if (starts <= now && ends > now) {
      count += 1;
      if (maxEnds === null || ends > maxEnds) maxEnds = ends;
    }
  }
  return {
    activeSilenceCount: count,
    activeSilenceExpiresAt:
      maxEnds === null ? null : new Date(maxEnds).toISOString(),
  };
}

export type AlertSummary = {
  id: string; // CC rule id
  repoid: string;
  slug: string;
  displayName: string | null;
  evaluationIntervalSeconds: number;
  severity: "info" | "warning" | "critical";
  currentState: "unknown" | "resolved" | "firing";
  active: boolean; // !paused
  health: string; // CcRuleHealth.status
  healthError: string | null;
  // Consecutive failed evaluations at the current health status, and when the
  // last failure happened. CC stamps `last_error_at` on every failed attempt,
  // making it the honest recency signal while degraded — `lastSeenAt`
  // (rollup.last_seen_at) only advances when the query returns rows, so it
  // freezes at a stale pre-failure time during a degraded streak.
  healthConsecutiveFailures: number;
  healthLastErrorAt: string | null;
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastSeenAt: string | null;
  firingInstanceCount: number;
  activeSilenceCount: number;
  activeSilenceExpiresAt: string | null;
  runbookProject: string | null;
  runbookSlug: string | null;
  // The owning preview registry id (null = live rule). Preview rules are
  // suppressed in CC: fully evaluated, never notifying.
  previewId: string | null;
  // Set only by the preview-overlay read (listAlerts/getAlert with `preview`).
  previewStatus?: PreviewStatus;
  // The `everr.repoid` annotation, verbatim, or null when the rule carries no
  // everr ownership annotations at all (a power-user/bare CC rule). Distinct
  // from `repoid` above, which falls back to `""` for display/identity
  // purposes; this field exists so the UI can badge as-code rules.
  ownedByRepo: string | null;
};

// CC RuleView → AlertSummary. The rolled-up alert state lives under the nested
// (optional) `rollup` object — read it defensively (a CC not yet on SP2 2a
// omits it).
function toSummary(r: CcRuleView, silence: ActiveSilenceInfo): AlertSummary {
  const v = fromCcRuleSpec(r.spec);
  const state =
    r.rollup?.alert_state === "firing"
      ? "firing"
      : r.rollup?.alert_state === "pending" ||
          r.rollup?.alert_state === "inactive"
        ? "resolved"
        : "unknown";
  return {
    id: r.id,
    repoid: v.repoid,
    slug: v.slug,
    displayName: v.displayName,
    evaluationIntervalSeconds: r.spec.interval_secs,
    severity: v.severity,
    currentState: state,
    active: !r.paused,
    health: r.health.status,
    healthError: r.health.last_error ?? null,
    healthConsecutiveFailures: r.health.consecutive_failures,
    healthLastErrorAt: r.health.last_error_at ?? null,
    lastFiredAt: r.rollup?.last_fired_at ?? null,
    lastResolvedAt: r.rollup?.last_resolved_at ?? null,
    lastSeenAt: r.rollup?.last_seen_at ?? null,
    firingInstanceCount: r.rollup?.firing_instance_count ?? 0,
    activeSilenceCount: silence.activeSilenceCount,
    activeSilenceExpiresAt: silence.activeSilenceExpiresAt,
    runbookProject: v.runbookProject,
    runbookSlug: v.runbookSlug,
    previewId: v.previewId,
    ownedByRepo: r.spec.annotations?.[OWN_REPO] ?? null,
  };
}

// What "changed" means for the live-vs-preview overlay: the spec minus the
// namespace bookkeeping. `suppressed` and the everr.preview annotation ARE the
// namespace split, and link.alert embeds the rule's own CC id — a live rule
// and its preview copy necessarily differ on all three, so none of them is a
// real edit. The ownership annotations (name/repo) are identical across the
// pair by construction and can stay.
function comparableSpec(spec: CcRuleSpec): Record<string, unknown> {
  const { suppressed: _suppressed, annotations, ...rest } = spec;
  const comparable = { ...annotations };
  delete comparable[OWN_PREVIEW];
  delete comparable[ANN_CC_LINK_ALERT];
  return { ...rest, annotations: comparable };
}

// A CC rule as the generic preview overlay sees it. An alert's identity is
// (repoid, slug): there is no project and no cross-repo ownership (two repos
// may declare the same slug). Feeding the repoid as the overlay's `project`
// keeps its owner-agnostic identity per-repo, so the cross-repo "conflict"
// status can never fire on legitimately coexisting same-slug rules.
function toOverlayRow(rule: CcRuleView) {
  const v = fromCcRuleSpec(rule.spec);
  return {
    rule,
    repoid: v.repoid,
    project: v.repoid,
    slug: v.slug,
    folderPath: "",
    previewId: v.previewId,
    document: comparableSpec(rule.spec),
  };
}

const alertIdInput = z.object({ alertId: z.string().min(1) });

type AlertDetail = AlertSummary & {
  display: { name?: string; description?: string };
  parsedQuery: string;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  instanceLabelColumns: string[];
  forSeconds: number;
  resolveAfter: number;
  valueColumn: string | null;
  runbookProject: string | null;
  runbookSlug: string | null;
  // Raw CC spec/version facts the plain-language Definition card summarizes
  // away, surfaced verbatim in the detail page's collapsed Advanced block for
  // power users and support triage.
  version: number;
  maxIntervalSecs: number | null;
  suppressed: boolean;
};

// The caller's role in the active organization — every call site gates a
// mutation scoped to session.activeOrganizationId.
async function ensureOrgAdmin() {
  const { role } = await auth.api.getActiveMemberRole({
    headers: getRequestHeaders(),
  });
  if (role !== "admin" && role !== "owner") {
    throw new Error("Only organization admins can manage alerts");
  }
}

export const listAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    const preview = data?.preview ?? null;
    const [rules, silences] = await Promise.all([
      cc.listRules(org),
      cc.listSilences(org),
    ]);
    const summarize = (r: CcRuleView): AlertSummary =>
      toSummary(r, activeSilencesForRule(silences, r.id));

    if (preview === null) {
      // Live list: every tenant rule (everr-owned and bare alike), except
      // preview rules (suppressed, everr.preview-tagged), which belong to
      // their preview's overlay and never show up here.
      return rules.filter((r) => previewIdOf(r.spec) === null).map(summarize);
    }

    // Preview overlay, mirroring the dashboards/runbooks reads: this preview's
    // rules replace the live ones for the repoids it covers (added / changed /
    // unchanged per rule, live-only rules marked removed). CC rules can't join
    // the previews table, so the registry resolves the preview name to its
    // (id → repoid) rows and the overlay runs in memory over the CC listing.
    const registry = await getPreviewRegistry(org, preview);
    const overlaid = overlayPreview({
      rows: rules
        // Live rules plus THIS preview's; other previews stay invisible.
        .filter((r) => {
          const pid = previewIdOf(r.spec);
          return pid === null || registry.has(pid);
        })
        .map(toOverlayRow),
      coveredRepoids: new Set(registry.values()),
    });
    return overlaid.map((row) => ({
      ...summarize(row.rule),
      previewStatus: row.previewStatus,
    }));
  });

// The detail-page analogue of the list overlay, scoped to one rule's
// (repoid, slug) identity: how the viewed rule relates to its counterpart on
// the other side of the live/preview split. Outside a preview context there is
// no status. Mirrors getDashboard: the status rides the loaderData up to the
// _previewable layout's preview bar. A live rule shadowed by a preview copy
// resolves to no status (the overlay keeps only the preview copy, which is
// where the /alerts list links while previewing).
async function detailPreviewStatus(
  org: string,
  rule: CcRuleView,
  preview: string | null,
): Promise<PreviewStatus | undefined> {
  if (preview === null) return undefined;
  const [registry, rules] = await Promise.all([
    getPreviewRegistry(org, preview),
    cc.listRules(org),
  ]);
  const identity = fromCcRuleSpec(rule.spec);
  const overlaid = overlayPreview({
    rows: rules
      .filter((r) => {
        if (!isOwnedRule(r.spec)) return false;
        const v = fromCcRuleSpec(r.spec);
        if (v.repoid !== identity.repoid || v.slug !== identity.slug)
          return false;
        const pid = previewIdOf(r.spec);
        return pid === null || registry.has(pid);
      })
      .map(toOverlayRow),
    coveredRepoids: new Set(registry.values()),
  });
  return overlaid.find((row) => row.rule.id === rule.id)?.previewStatus;
}

export const getAlert = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput.extend({ preview: z.string().optional() }))
  .handler(async ({ data: { alertId, preview }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    // Any tenant rule id works, everr-owned or bare: a nonexistent id surfaces
    // as the CC 404 raised by getRule, not a managed-ownership guard here.
    const rule = await cc.getRule(org, alertId);
    const view = fromCcRuleSpec(rule.spec);
    const [silences, previewStatus] = await Promise.all([
      cc.listSilences(org),
      detailPreviewStatus(org, rule, preview ?? null),
    ]);
    return {
      ...toSummary(rule, activeSilencesForRule(silences, alertId)),
      previewStatus,
      display: {
        name: view.displayName ?? undefined,
        description: view.displayDescription ?? undefined,
      },
      parsedQuery: rule.spec.sql,
      notificationTitleTemplate: view.notificationTitleTemplate,
      notificationDescriptionTemplate: view.notificationDescriptionTemplate,
      instanceLabelColumns: view.instanceLabelColumns,
      forSeconds: view.forSeconds,
      resolveAfter: view.resolveAfter,
      valueColumn: view.valueColumn,
      runbookProject: view.runbookProject,
      runbookSlug: view.runbookSlug,
      version: rule.version,
      maxIntervalSecs: rule.spec.max_interval_secs ?? null,
      suppressed: view.suppressed,
    } satisfies AlertDetail;
  });

export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  // "pending": the rule's condition matched, but not for `for_secs` yet, so it
  // has not started firing (and never notifies) — CC's anti-flap window.
  state: "firing" | "pending" | "resolved";
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastRow: Record<string, unknown>;
  lastEvaluationRows: Record<string, unknown>[];
  lastEvaluationTitle: string | null;
  lastEvaluationDescription: string | null;
  silenced: boolean;
};

export const listAlertInstances = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput.extend({ timeRange: TimeRangeSchema }))
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    // Any tenant rule id works, everr-owned or bare: a nonexistent id
    // surfaces as the CC 404 raised by getRule.
    const [, alerts, silences] = await Promise.all([
      cc.getRule(org, alertId),
      cc.listAlerts(org),
      cc.listSilences(org),
    ]);
    // Only this rule's silences scope its instances.
    const scoped = silences
      .filter((s) => silenceScopedToRule(s, alertId))
      .map((s) => ({
        matchers: ccToUiMatchers(
          s.matchers.filter((m) => m.label !== RULE_LABEL),
        ),
      }));
    return alerts
      .filter(
        (a) =>
          a.rule === alertId &&
          (a.status === "firing" || a.status === "pending"),
      )
      .map((a) => ({
        fingerprint: a.key,
        labels: a.labels,
        state: a.status as "firing" | "pending",
        lastFiredAt: a.active_since,
        lastResolvedAt: null,
        lastRow: a.value === null ? {} : { value: a.value },
        lastEvaluationRows: a.value === null ? [] : [{ value: a.value }],
        lastEvaluationTitle: null,
        lastEvaluationDescription: null,
        silenced: Boolean(findSilenceForInstance(scoped, a.labels)),
      })) satisfies AlertInstanceSummary[];
  });

export type AlertSilenceSummary = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdByUserId: string;
  matchers: Matcher[];
};

export const listAlertSilences = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    // Any tenant rule id works, everr-owned or bare: a nonexistent id
    // surfaces as the CC 404 raised by getRule.
    await cc.getRule(org, alertId);
    const silences = await cc.listSilences(org);
    return silences
      .filter((s) => silenceScopedToRule(s, alertId))
      .map((s) => ({
        id: s.id,
        startsAt: new Date(s.starts_at),
        endsAt: new Date(s.ends_at),
        reason: s.comment ?? "",
        createdByUserId: s.author ?? "",
        // Hide the synthetic rule matcher from the UI.
        matchers: ccToUiMatchers(
          s.matchers.filter((m) => m.label !== RULE_LABEL),
        ),
      })) satisfies AlertSilenceSummary[];
  });

export const createSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    alertIdInput.extend({
      endsAt: z.string().datetime(),
      reason: z.string().trim().max(500).default(""),
      matchers: MatchersSchema.default([]),
    }),
  )
  .handler(
    async ({
      data: { alertId, endsAt, reason, matchers },
      context: { session },
    }) => {
      const org = session.session.activeOrganizationId;
      await ensureOrgAdmin();
      // Any tenant rule id works, everr-owned or bare: a nonexistent id
      // surfaces as the CC 404 raised by getRule.
      await cc.getRule(org, alertId);
      validateMatchers(matchers);
      const startsAt = new Date();
      if (new Date(endsAt) <= startsAt) {
        throw new Error("Silence end time must be in the future");
      }
      return cc.createSilence(org, {
        starts_at: startsAt.toISOString(),
        ends_at: endsAt,
        comment: reason || undefined,
        author: session.user.id,
        matchers: [
          { label: RULE_LABEL, op: "eq", value: alertId },
          ...matchers.map((m) => ({
            label: m.label,
            op: UI_OP_TO_CC[m.op],
            value: m.value,
          })),
        ],
      });
    },
  );

export const cancelSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ silenceId: z.string().min(1) }))
  .handler(async ({ data: { silenceId }, context: { session } }) => {
    await ensureOrgAdmin();
    return cc.deleteSilence(session.session.activeOrganizationId, silenceId);
  });

export const getAlertSettings = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const org = session.session.activeOrganizationId;
  const [receivers, routes] = await Promise.all([
    cc.listReceivers(org),
    cc.listRoutes(org),
  ]);
  // The re-notify cadence rides on the managed catch-all routes, so read it
  // back alongside the receivers.
  return { delivery: receiversToDeliverySettings(receivers, routes) };
});

// Ensure one catch-all route (empty matchers) per managed receiver, each
// carrying the chosen re-notify cadence. Each route has `continue: true` so
// both managed receivers fire, and distinct high priority numbers so
// lower-priority power-user routes evaluate first. A missing route is created;
// an existing one is reconciled in place via updateRoute (never delete +
// recreate, whose gap would misroute events), touching only
// repeat_interval_secs and carrying every other field over unchanged.
async function ensureCatchAllRoutes(
  org: string,
  repeatIntervalSecs: number | null,
) {
  const routes = await cc.listRoutes(org);
  const wanted: [string, number][] = [
    [DEFAULT_EMAIL_RECEIVER, 1000],
    [DEFAULT_TELEGRAM_RECEIVER, 1001],
    [DEFAULT_SLACK_RECEIVER, 1002],
  ];
  for (const [receiver, priority] of wanted) {
    const existing = routes.find(
      (r) => r.matchers.length === 0 && r.receiver === receiver,
    );
    if (!existing) {
      await cc.createRoute(org, {
        matchers: [],
        receiver,
        continue: true,
        priority,
        group_by: null,
        group_wait_secs: null,
        group_interval_secs: null,
        repeat_interval_secs: repeatIntervalSecs,
      });
    } else if (existing.repeat_interval_secs !== repeatIntervalSecs) {
      await cc.updateRoute(org, existing.id, {
        matchers: existing.matchers,
        receiver: existing.receiver,
        continue: existing.continue,
        priority: existing.priority,
        group_by: existing.group_by,
        group_wait_secs: existing.group_wait_secs,
        group_interval_secs: existing.group_interval_secs,
        repeat_interval_secs: repeatIntervalSecs,
      });
    }
  }
}

export const updateAlertSettings = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ delivery: DeliverySettingsSchema }))
  .handler(async ({ data: { delivery }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const n = normalizeDeliverySettings(delivery);
    // Provision/refresh the two managed receivers.
    await cc.upsertReceiver(org, {
      name: DEFAULT_EMAIL_RECEIVER,
      channel: { type: "email", to: n.email.enabled ? n.email.to : [] },
    });
    await cc.upsertReceiver(org, {
      name: DEFAULT_TELEGRAM_RECEIVER,
      channel: {
        type: "telegram",
        bot_token: n.telegram.enabled ? n.telegram.botToken : "",
        chat_ids: n.telegram.enabled ? n.telegram.chatIds : [],
      },
    });
    await cc.upsertReceiver(org, {
      name: DEFAULT_SLACK_RECEIVER,
      channel: {
        type: "slack",
        url: n.slack.enabled ? n.slack.webhookUrl : "",
      },
    });
    await ensureCatchAllRoutes(org, n.remindEverySeconds);
    return { delivery: n };
  });

export const deactivateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    await ensureOrgAdmin();
    return cc.pauseRule(session.session.activeOrganizationId, alertId);
  });

export const activateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    await ensureOrgAdmin();
    return cc.resumeRule(session.session.activeOrganizationId, alertId);
  });

// Ad-hoc evaluation of the alert's current spec against ClickHouse, changing no
// state (no instances, events, or notifications). Gated like the pause/resume
// mutations: the simplified page never exposes the raw CC spec, so, unlike the
// power-user testCcRule, the spec is loaded here from the rule itself rather
// than trusted from the client.
export const testAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    // Any tenant rule id works, everr-owned or bare: a nonexistent id surfaces
    // as the CC 404 raised by getRule, not a managed-ownership guard here.
    const rule = await cc.getRule(org, alertId);
    return cc.testRule(org, alertId, rule.spec);
  });
