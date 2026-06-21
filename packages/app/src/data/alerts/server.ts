import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { alertDefinitions, alertSettings, alertSilences } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  extractInstanceLabels,
  instanceFingerprint,
  parseLabels,
} from "@/server/alerts/02-instances";
import { OPERATIONAL_EVENT_TYPES } from "@/server/alerts/03-events";
import {
  ALERT_CHANNELS,
  type AlertDeliveryTargets,
  DeliverySettingsSchema,
  ensureDeliveryDefaults,
  redactDeliverySecrets,
  resolveDeliverySettings,
} from "./delivery-settings";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  validateMatchers,
} from "./matchers";
import type { AlertRuleYaml } from "./schema";
import { activeSilenceConditions } from "./silences";
import { renderMessage } from "./template";

type AlertEventInstance = {
  state: "firing" | "resolved";
  labels: Record<string, string>;
};

type AlertEvidenceValue =
  | string
  | number
  | boolean
  | null
  | AlertEvidenceValue[]
  | { [key: string]: AlertEvidenceValue };

type AlertDisplay = {
  name?: string;
  description?: string;
};

export type AlertSummary = {
  id: string;
  repoid: string;
  slug: string;
  project: string;
  displayName: string | null;
  evaluationIntervalSeconds: number;
  sourceLink: string;
  configFilePath: string;
  notebookProject: string;
  notebookSlug: string;
  currentState: "unknown" | "resolved" | "firing";
  active: boolean;
  lastEvaluationStatus: string;
  lastEvaluationError: string;
  lastEvaluatedAt: Date | null;
  lastFiredAt: Date | null;
  lastResolvedAt: Date | null;
  lastSeenAt: Date | null;
  lastRowCount: number;
  lastEvidenceSnapshot: AlertEvidenceValue;
  firingInstanceCount: number;
  activeSilenceCount: number;
  activeSilenceExpiresAt: Date | string | null;
};

type AlertDetail = AlertSummary & {
  display: AlertDisplay;
  document: AlertRuleYaml;
  parsedQuery: string;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  instanceLabelColumns: string[];
};

type AlertEvent = {
  eventId: string;
  alertDefinitionId: string;
  repoid: string;
  slug: string;
  eventType: string;
  eventTime: string;
  evaluationScheduledAt: string | null;
  rowCount: number;
  evidenceTruncated: boolean;
  evidenceJson: string;
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
  instances: AlertEventInstance[];
};

type AlertSummaryRow = Omit<
  AlertSummary,
  "activeSilenceCount" | "displayName"
> & {
  activeSilenceCount?: number | string;
  active_silence_count?: number | string;
  activeSilenceExpiresAt?: Date | string | null;
  active_silence_expires_at?: Date | string | null;
  document: unknown;
};

const alertIdInput = z.object({ alertId: z.string().uuid() });

// Subquery instead of a join: a rule can have several active silences and a
// join would duplicate list rows.
const activeSilenceCountSql = sql<number>`(
  select count(*)::int
  from alert_silences s
  where s.organization_id = alert_definitions.organization_id
    and s.alert_definition_id = alert_definitions.id
    and s.starts_at <= now()
    and s.ends_at > now()
    and s.cancelled_at is null
)`.as("activeSilenceCount");

// max(): with several overlapping silences the alert stays silenced until the
// last one ends, so this is when silencing actually lifts.
const activeSilenceExpiresAtSql = sql<Date | null>`(
  select max(s.ends_at)
  from alert_silences s
  where s.organization_id = alert_definitions.organization_id
    and s.alert_definition_id = alert_definitions.id
    and s.starts_at <= now()
    and s.ends_at > now()
    and s.cancelled_at is null
)`.as("activeSilenceExpiresAt");

const alertListColumns = {
  id: alertDefinitions.id,
  repoid: alertDefinitions.repoid,
  slug: alertDefinitions.slug,
  project: alertDefinitions.project,
  evaluationIntervalSeconds: alertDefinitions.evaluationIntervalSeconds,
  sourceLink: alertDefinitions.sourceLink,
  configFilePath: alertDefinitions.configFilePath,
  notebookProject: alertDefinitions.notebookProject,
  notebookSlug: alertDefinitions.notebookSlug,
  currentState: alertDefinitions.currentState,
  active: alertDefinitions.active,
  lastEvaluationStatus: alertDefinitions.lastEvaluationStatus,
  lastEvaluationError: alertDefinitions.lastEvaluationError,
  lastEvaluatedAt: alertDefinitions.lastEvaluatedAt,
  lastFiredAt: alertDefinitions.lastFiredAt,
  lastResolvedAt: alertDefinitions.lastResolvedAt,
  lastSeenAt: alertDefinitions.lastSeenAt,
  lastRowCount: alertDefinitions.lastRowCount,
  lastEvidenceSnapshot: alertDefinitions.lastEvidenceSnapshot,
  firingInstanceCount: alertDefinitions.firingInstanceCount,
  activeSilenceCount: activeSilenceCountSql,
  activeSilenceExpiresAt: activeSilenceExpiresAtSql,
} as const;

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

function toAlertSummary(row: AlertSummaryRow): AlertSummary {
  const { active_silence_count, active_silence_expires_at, document, ...rest } =
    row;
  return {
    ...rest,
    displayName: displayFromDocument(document).name ?? null,
    lastEvidenceSnapshot: rest.lastEvidenceSnapshot ?? [],
    activeSilenceCount:
      Number(rest.activeSilenceCount ?? active_silence_count) || 0,
    activeSilenceExpiresAt:
      rest.activeSilenceExpiresAt ?? active_silence_expires_at ?? null,
  };
}

function clickhouseIsoMillis(column: string): string {
  return `concat(formatDateTime(${column}, '%Y-%m-%dT%H:%i:%S', 'UTC'), '.', substring(formatDateTime(${column}, '%f', 'UTC'), 1, 3), 'Z')`;
}

const alertDisplaySchema = z
  .object({
    spec: z
      .object({
        display: z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
          })
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

function displayFromDocument(document: unknown): AlertDisplay {
  const parsed = alertDisplaySchema.safeParse(document);
  return parsed.success ? (parsed.data.spec.display ?? {}) : {};
}

async function getAlertRow(alertId: string, organizationId: string) {
  const [row] = await db
    .select({
      ...alertListColumns,
      document: alertDefinitions.document,
      parsedQuery: alertDefinitions.parsedQuery,
      notificationTitleTemplate: alertDefinitions.notificationTitleTemplate,
      notificationDescriptionTemplate:
        alertDefinitions.notificationDescriptionTemplate,
      instanceLabelColumns: alertDefinitions.instanceLabelColumns,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, alertId),
        isNull(alertDefinitions.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export const listAlerts = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const organizationId = session.session.activeOrganizationId;
  const rows = await db
    .select({ ...alertListColumns, document: alertDefinitions.document })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        isNull(alertDefinitions.deletedAt),
      ),
    )
    .orderBy(
      desc(alertDefinitions.active),
      desc(alertDefinitions.lastEvaluatedAt),
      alertDefinitions.repoid,
      alertDefinitions.slug,
    );

  return rows.map((row) => toAlertSummary(row as AlertSummaryRow));
});

export const getAlert = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const row = await getAlertRow(
      alertId,
      session.session.activeOrganizationId,
    );
    if (!row) throw new Error("Alert not found");
    return {
      ...toAlertSummary(row as AlertSummaryRow),
      display: displayFromDocument(row.document),
      document: row.document,
      parsedQuery: row.parsedQuery,
      notificationTitleTemplate: row.notificationTitleTemplate,
      notificationDescriptionTemplate: row.notificationDescriptionTemplate,
      instanceLabelColumns: row.instanceLabelColumns,
    } satisfies AlertDetail;
  });

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
      const organizationId = session.session.activeOrganizationId;
      const alert = await getAlertRow(alertId, organizationId);
      if (!alert) throw new Error("Alert not found");
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      const rows = await clickhouse.query<{
        eventId: string;
        alertDefinitionId: string;
        repoid: string;
        slug: string;
        eventType: string;
        eventTime: string;
        evaluationScheduledAt: string;
        rowCount: number;
        evidenceTruncated: number;
        evidenceJson: string;
        deliveryTargetsJson: string;
        silenceId: string;
        instanceLabelsJson: string[];
      }>(
        `
	          WITH history AS (
	            SELECT
	              tenant_id,
	              alert_definition_id,
	              repoid,
	              slug,
	              event_id,
	              event_type,
	              event_time,
	              evaluation_scheduled_at,
	              row_count,
	              evidence_truncated,
	              evidence_json,
	              toJSONString(delivery_targets) AS deliveryTargetsJson,
	              silence_id
	            FROM app.alert_events
	            WHERE tenant_id = {organizationId:String}
	              AND repoid = {repoid:String}
	              AND slug = {slug:String}
	              AND alert_definition_id = {alertDefinitionId:String}
	              AND event_type NOT IN (${OPERATIONAL_EVENT_TYPES.map((t) => `'${t}'`).join(", ")})
	              AND event_time >= {fromTime:String}
	              AND event_time <= {toTime:String}
	            ORDER BY event_time DESC, event_id DESC
	            LIMIT {limit:UInt32}
	          )
	          SELECT
	            toString(history.event_id) AS eventId,
	            history.alert_definition_id AS alertDefinitionId,
	            history.repoid AS repoid,
	            history.slug AS slug,
	            history.event_type AS eventType,
	            ${clickhouseIsoMillis("history.event_time")} AS eventTime,
	            if(history.evaluation_scheduled_at = toDateTime64(0, 3), '', ${clickhouseIsoMillis("history.evaluation_scheduled_at")}) AS evaluationScheduledAt,
	            history.row_count AS rowCount,
	            history.evidence_truncated AS evidenceTruncated,
	            history.evidence_json AS evidenceJson,
	            history.deliveryTargetsJson AS deliveryTargetsJson,
	            history.silence_id AS silenceId,
	            groupArrayIf(
	              instance_events.instance_labels_json,
	              (history.event_type = 'firing' AND instance_events.event_type = 'instance_fired')
	                OR (history.event_type = 'resolved' AND instance_events.event_type = 'instance_resolved')
	            ) AS instanceLabelsJson
	          FROM history
	          LEFT JOIN (
	            SELECT evaluation_scheduled_at, event_type, instance_labels_json
	            FROM app.alert_events
	            WHERE tenant_id = {organizationId:String}
	              AND repoid = {repoid:String}
	              AND slug = {slug:String}
	              AND alert_definition_id = {alertDefinitionId:String}
	              AND event_type IN ('instance_fired', 'instance_resolved')
	              AND evaluation_scheduled_at IN (SELECT evaluation_scheduled_at FROM history)
	              AND event_time >= {fromTime:String}
	              AND event_time <= {toTime:String}
	          ) AS instance_events
	            ON instance_events.evaluation_scheduled_at = history.evaluation_scheduled_at
	          GROUP BY
	            history.tenant_id,
	            history.alert_definition_id,
	            history.repoid,
	            history.slug,
	            history.event_id,
	            history.event_type,
	            history.event_time,
	            history.evaluation_scheduled_at,
	            history.row_count,
	            history.evidence_truncated,
	            history.evidence_json,
	            history.deliveryTargetsJson,
	            history.silence_id
	          ORDER BY history.event_time DESC, history.event_id DESC
	        `,
        {
          organizationId,
          repoid: alert.repoid,
          slug: alert.slug,
          alertDefinitionId: alert.id,
          limit,
          fromTime: fromISO,
          toTime: toISO,
        },
      );

      return rows.map((row) => ({
        eventId: row.eventId,
        alertDefinitionId: row.alertDefinitionId,
        repoid: row.repoid,
        slug: row.slug,
        eventType: row.eventType,
        eventTime: row.eventTime,
        evaluationScheduledAt: row.evaluationScheduledAt || null,
        rowCount: Number(row.rowCount),
        evidenceTruncated: Boolean(row.evidenceTruncated),
        evidenceJson: row.evidenceJson,
        deliveryTargets: parseDeliveryTargets(row.deliveryTargetsJson),
        silenceId: row.silenceId,
        instances: parseEventInstances(row.eventType, row.instanceLabelsJson),
      })) satisfies AlertEvent[];
    },
  );

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

function parseEventInstances(
  eventType: string,
  labelsJson: readonly string[],
): AlertEventInstance[] {
  const state =
    eventType === "firing"
      ? "firing"
      : eventType === "resolved"
        ? "resolved"
        : null;
  if (!state) return [];
  return labelsJson.map((json) => ({
    state,
    labels: parseLabels(json),
  }));
}

function evidenceRows(
  value: AlertEvidenceValue | null | undefined,
): Record<string, AlertEvidenceValue>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, AlertEvidenceValue> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  state: "firing" | "resolved";
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastRow: Record<string, AlertEvidenceValue>;
  lastEvaluationRows: Record<string, AlertEvidenceValue>[];
  lastEvaluationTitle: string | null;
  lastEvaluationDescription: string | null;
  silenced: boolean;
};

async function listActiveSilenceRows(alertId: string, organizationId: string) {
  return db
    .select({
      id: alertSilences.id,
      startsAt: alertSilences.startsAt,
      endsAt: alertSilences.endsAt,
      reason: alertSilences.reason,
      createdByUserId: alertSilences.createdByUserId,
      matchers: alertSilences.matchers,
    })
    .from(alertSilences)
    .where(activeSilenceConditions(organizationId, alertId))
    .orderBy(desc(alertSilences.endsAt));
}

export const listAlertInstances = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput.extend({ timeRange: TimeRangeSchema }))
  .handler(
    async ({
      data: { alertId, timeRange },
      context: { session, clickhouse },
    }) => {
      const organizationId = session.session.activeOrganizationId;
      const [alert, silences] = await Promise.all([
        getAlertRow(alertId, organizationId),
        listActiveSilenceRows(alertId, organizationId),
      ]);
      if (!alert) throw new Error("Alert not found");
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      const rows = await clickhouse.query<{
        fingerprint: string;
        lastEventType: string;
        labelsJson: string;
        lastFiredEvidenceJson: string;
        lastFiredAt: string;
        lastResolvedAt: string;
      }>(
        `
        SELECT
          instance_fingerprint AS fingerprint,
          argMax(event_type, event_time) AS lastEventType,
          argMax(instance_labels_json, event_time) AS labelsJson,
          argMaxIf(evidence_json, event_time, event_type = 'instance_fired') AS lastFiredEvidenceJson,
          if(countIf(event_type = 'instance_fired') = 0, '', ${clickhouseIsoMillis("maxIf(event_time, event_type = 'instance_fired')")}) AS lastFiredAt,
          if(countIf(event_type = 'instance_resolved') = 0, '', ${clickhouseIsoMillis("maxIf(event_time, event_type = 'instance_resolved')")}) AS lastResolvedAt
        FROM app.alert_events
        WHERE tenant_id = {organizationId:String}
          AND repoid = {repoid:String}
          AND slug = {slug:String}
          AND alert_definition_id = {alertDefinitionId:String}
          AND event_type IN ('instance_fired', 'instance_resolved')
          AND event_time >= {fromTime:String}
          AND event_time <= {toTime:String}
        GROUP BY instance_fingerprint
        ORDER BY (lastEventType = 'instance_fired') DESC, max(event_time) DESC
        LIMIT 500
      `,
        {
          organizationId,
          repoid: alert.repoid,
          slug: alert.slug,
          alertDefinitionId: alert.id,
          fromTime: fromISO,
          toTime: toISO,
        },
      );

      const instanceLabelColumns = alert.instanceLabelColumns ?? [];
      // Group snapshot rows by the same fingerprint the evaluator wrote to
      // instance events, so each instance's rows are a single Map lookup.
      const snapshotRowsByFingerprint = new Map<
        string,
        Record<string, AlertEvidenceValue>[]
      >();
      for (const row of evidenceRows(
        alert.lastEvidenceSnapshot as AlertEvidenceValue | undefined,
      )) {
        const fingerprint = instanceFingerprint(
          extractInstanceLabels(row, instanceLabelColumns),
        );
        const group = snapshotRowsByFingerprint.get(fingerprint);
        if (group) {
          group.push(row);
        } else {
          snapshotRowsByFingerprint.set(fingerprint, [row]);
        }
      }

      return rows.map((row) => {
        const labels = parseLabels(row.labelsJson);
        const state =
          row.lastEventType === "instance_fired" ? "firing" : "resolved";
        const lastEvaluationRows =
          state === "firing"
            ? (snapshotRowsByFingerprint.get(row.fingerprint) ?? [])
            : [];
        const firstEvaluationRow = lastEvaluationRows[0];
        return {
          fingerprint: row.fingerprint,
          labels,
          state,
          lastFiredAt: row.lastFiredAt || null,
          lastResolvedAt: row.lastResolvedAt || null,
          lastRow: parseJsonObject(row.lastFiredEvidenceJson) as Record<
            string,
            AlertEvidenceValue
          >,
          lastEvaluationRows,
          lastEvaluationTitle: firstEvaluationRow
            ? renderMessage(alert.notificationTitleTemplate, {
                firstRow: firstEvaluationRow,
              })
            : null,
          lastEvaluationDescription:
            firstEvaluationRow && alert.notificationDescriptionTemplate
              ? renderMessage(alert.notificationDescriptionTemplate, {
                  firstRow: firstEvaluationRow,
                })
              : null,
          silenced:
            state === "firing" &&
            Boolean(findSilenceForInstance(silences, labels)),
        } satisfies AlertInstanceSummary;
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
    const organizationId = session.session.activeOrganizationId;
    const alert = await getAlertRow(alertId, organizationId);
    if (!alert) throw new Error("Alert not found");
    const rows = await listActiveSilenceRows(alertId, organizationId);
    return rows satisfies AlertSilenceSummary[];
  });

export const getAlertSettings = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const [row] = await db
    .select({ delivery: alertSettings.delivery })
    .from(alertSettings)
    .where(
      eq(alertSettings.organizationId, session.session.activeOrganizationId),
    )
    .limit(1);

  return {
    delivery: redactDeliverySecrets(ensureDeliveryDefaults(row?.delivery)),
  };
});

export const updateAlertSettings = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ delivery: DeliverySettingsSchema }))
  .handler(async ({ data: { delivery }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const now = new Date();

    const [existing] = await db
      .select({ delivery: alertSettings.delivery })
      .from(alertSettings)
      .where(eq(alertSettings.organizationId, organizationId))
      .limit(1);

    const stored = ensureDeliveryDefaults(existing?.delivery);
    const resolved = resolveDeliverySettings(stored, delivery);

    await db
      .insert(alertSettings)
      .values({ organizationId, delivery: resolved, updatedAt: now })
      .onConflictDoUpdate({
        target: alertSettings.organizationId,
        set: { delivery: resolved, updatedAt: now },
      });

    return { delivery: redactDeliverySecrets(resolved) };
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
      const organizationId = session.session.activeOrganizationId;
      await ensureOrgAdmin();
      const alert = await getAlertRow(alertId, organizationId);
      if (!alert) throw new Error("Alert not found");

      validateMatchers(matchers);

      const startsAt = new Date();
      const parsedEndsAt = new Date(endsAt);
      if (parsedEndsAt <= startsAt) {
        throw new Error("Silence end time must be in the future");
      }

      const [row] = await db
        .insert(alertSilences)
        .values({
          organizationId,
          alertDefinitionId: alertId,
          startsAt,
          endsAt: parsedEndsAt,
          reason,
          matchers,
          createdByUserId: session.user.id,
        })
        .returning({
          id: alertSilences.id,
          startsAt: alertSilences.startsAt,
          endsAt: alertSilences.endsAt,
          reason: alertSilences.reason,
          matchers: alertSilences.matchers,
          createdByUserId: alertSilences.createdByUserId,
        });

      return row;
    },
  );

export const cancelSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ silenceId: z.string().uuid() }))
  .handler(async ({ data: { silenceId }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const now = new Date();
    const [row] = await db
      .update(alertSilences)
      .set({
        cancelledAt: now,
        cancelledByUserId: session.user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(alertSilences.organizationId, organizationId),
          eq(alertSilences.id, silenceId),
          isNull(alertSilences.cancelledAt),
        ),
      )
      .returning({ id: alertSilences.id });

    if (!row) throw new Error("Silence not found");
    return row;
  });

// Admin-gated, org-scoped active toggle. Activation resumes scheduling
// immediately (the scanner picks the alert up on its next tick) and keeps
// runtime state — unlike an `everr apply` revival, the definition hasn't
// changed, and the next evaluation corrects a stale firing/resolved state.
async function setAlertActive(
  alertId: string,
  organizationId: string,
  active: boolean,
) {
  await ensureOrgAdmin();
  const now = new Date();
  const [row] = await db
    .update(alertDefinitions)
    .set({
      active,
      nextEvaluationAt: active ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, alertId),
      ),
    )
    .returning({ id: alertDefinitions.id });

  if (!row) throw new Error("Alert not found");
  return row;
}

export const deactivateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(({ data: { alertId }, context: { session } }) =>
    setAlertActive(alertId, session.session.activeOrganizationId, false),
  );

export const activateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(({ data: { alertId }, context: { session } }) =>
    setAlertActive(alertId, session.session.activeOrganizationId, true),
  );
