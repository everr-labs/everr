import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import * as cc from "@/data/cc/client";
import type { CcMatcher, CcRuleView, CcSilence } from "@/data/cc/types";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  ALERT_CHANNELS,
  type AlertDeliveryTargets,
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
  DeliverySettingsSchema,
  normalizeDeliverySettings,
  receiversToDeliverySettings,
} from "./delivery-settings";
import { queryAlertHistory } from "./history.server";
import { fromCcRuleSpec, isManagedSimple } from "./mapping";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  validateMatchers,
} from "./matchers";

// A simple alert's silences are scoped to the rule by a synthetic `rule` label
// carrying the rule's id (CC does not stamp the slug as a label, so an
// `alertname` matcher never matches). The create path writes this matcher; the
// list/count paths filter on it; the UI never sees it.
const RULE_LABEL = "rule";

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
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastSeenAt: string | null;
  firingInstanceCount: number;
  activeSilenceCount: number;
};

// CC RuleView → AlertSummary. The rolled-up alert state lives under the nested
// (optional) `rollup` object — read it defensively (a CC not yet on SP2 2a
// omits it).
function toSummary(r: CcRuleView, silenceCount: number): AlertSummary {
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
    lastFiredAt: r.rollup?.last_fired_at ?? null,
    lastResolvedAt: r.rollup?.last_resolved_at ?? null,
    lastSeenAt: r.rollup?.last_seen_at ?? null,
    firingInstanceCount: r.rollup?.firing_instance_count ?? 0,
    activeSilenceCount: silenceCount,
  };
}

const alertIdInput = z.object({ alertId: z.string().min(1) });

type AlertDetail = AlertSummary & {
  display: { name?: string; description?: string };
  parsedQuery: string;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  instanceLabelColumns: string[];
  runbookProject: string | null;
  runbookSlug: string | null;
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

export const listAlerts = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const org = session.session.activeOrganizationId;
  const [rules, silences] = await Promise.all([
    cc.listRules(org),
    cc.listSilences(org),
  ]);
  return rules
    .filter((r) => isManagedSimple(r.spec))
    .map((r) => {
      const count = silences.filter((s) => silenceScopedToRule(s, r.id)).length;
      return toSummary(r, count);
    });
});

export const getAlert = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const org = session.session.activeOrganizationId;
    const rule = await cc.getRule(org, alertId);
    if (!isManagedSimple(rule.spec)) throw new Error("Alert not found");
    const view = fromCcRuleSpec(rule.spec);
    const silences = await cc.listSilences(org);
    const count = silences.filter((s) =>
      silenceScopedToRule(s, alertId),
    ).length;
    return {
      ...toSummary(rule, count),
      display: {
        name: view.displayName ?? undefined,
        description: view.displayDescription ?? undefined,
      },
      parsedQuery: rule.spec.sql,
      notificationTitleTemplate: view.notificationTitleTemplate,
      notificationDescriptionTemplate: view.notificationDescriptionTemplate,
      instanceLabelColumns: view.instanceLabelColumns,
      runbookProject: view.runbookProject,
      runbookSlug: view.runbookSlug,
    } satisfies AlertDetail;
  });

export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  state: "firing" | "resolved";
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
    const [rule, alerts, silences] = await Promise.all([
      cc.getRule(org, alertId),
      cc.listAlerts(org),
      cc.listSilences(org),
    ]);
    if (!isManagedSimple(rule.spec)) throw new Error("Alert not found");
    // Only this rule's silences scope its instances.
    const scoped = silences
      .filter((s) => silenceScopedToRule(s, alertId))
      .map((s) => ({
        matchers: ccToUiMatchers(
          s.matchers.filter((m) => m.label !== RULE_LABEL),
        ),
      }));
    return alerts
      .filter((a) => a.rule === alertId && a.status === "firing")
      .map((a) => ({
        fingerprint: a.key,
        labels: a.labels,
        state: "firing" as const,
        lastFiredAt: a.active_since,
        lastResolvedAt: null,
        lastRow: a.value === null ? {} : { value: a.value },
        lastEvaluationRows: a.value === null ? [] : [{ value: a.value }],
        lastEvaluationTitle: null,
        lastEvaluationDescription: null,
        silenced: Boolean(findSilenceForInstance(scoped, a.labels)),
      })) satisfies AlertInstanceSummary[];
  });

type AlertEvent = {
  eventId: string;
  slug: string;
  eventType: string;
  eventTime: string;
  rowCount: number;
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
  instances: { state: "firing" | "resolved"; labels: Record<string, string> }[];
};

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed snapshots
  }
  return {};
}

function parseDeliveryTargets(json: string): AlertDeliveryTargets {
  const parsed = parseJsonObject(json);
  const targets: AlertDeliveryTargets = {};
  for (const channel of ALERT_CHANNELS) {
    const value = parsed[channel];
    if (Array.isArray(value)) {
      targets[channel] = value.map((item) => String(item));
    }
  }
  return targets;
}

function stringifyValues(obj: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      v === null || v === undefined
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v),
    ]),
  );
}

export const listAlertEvents = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    alertIdInput.extend({
      limit: z.number().int().min(1).max(100).default(50),
      timeRange: TimeRangeSchema,
    }),
  )
  .handler(
    async ({
      data: { alertId, limit, timeRange },
      context: { session, clickhouse },
    }) => {
      const org = session.session.activeOrganizationId;
      const rule = await cc.getRule(org, alertId);
      if (!isManagedSimple(rule.spec)) throw new Error("Alert not found");
      const slug = fromCcRuleSpec(rule.spec).slug;
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      const rows = await queryAlertHistory(clickhouse.query, slug, {
        limit,
        fromISO,
        toISO,
      });
      return rows.map((row, i) => {
        const labels = parseJsonObject(row.instanceLabelsJson);
        const state =
          row.eventType === "instance_resolved" ? "resolved" : "firing";
        return {
          eventId: `${row.timestamp}:${row.instanceFingerprint || i}`,
          slug,
          eventType: row.eventType,
          eventTime: row.timestamp,
          rowCount: Number(row.rowCount) || 0,
          deliveryTargets: parseDeliveryTargets(row.deliveryTargetsJson),
          silenceId: row.silenced === "true" ? "silenced" : "",
          instances: [{ state, labels: stringifyValues(labels) }],
        } satisfies AlertEvent;
      });
    },
  );

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
    const rule = await cc.getRule(org, alertId);
    if (!isManagedSimple(rule.spec)) throw new Error("Alert not found");
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
      const rule = await cc.getRule(org, alertId);
      if (!isManagedSimple(rule.spec)) throw new Error("Alert not found");
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
  const receivers = await cc.listReceivers(
    session.session.activeOrganizationId,
  );
  return { delivery: receiversToDeliverySettings(receivers) };
});

// Ensure one catch-all route (empty matchers) per managed receiver. Each route
// has `continue: true` so both managed receivers fire, and distinct high
// priority numbers so lower-priority power-user routes evaluate first.
async function ensureCatchAllRoutes(org: string) {
  const routes = await cc.listRoutes(org);
  const wanted: [string, number][] = [
    [DEFAULT_EMAIL_RECEIVER, 1000],
    [DEFAULT_TELEGRAM_RECEIVER, 1001],
  ];
  for (const [receiver, priority] of wanted) {
    const has = routes.some(
      (r) => r.matchers.length === 0 && r.receiver === receiver,
    );
    if (!has) {
      await cc.createRoute(org, {
        matchers: [],
        receiver,
        continue: true,
        priority,
        group_by: null,
        group_wait_secs: null,
        group_interval_secs: null,
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
    await ensureCatchAllRoutes(org);
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
