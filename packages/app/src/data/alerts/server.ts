import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { alertDefinitions, alertSettings, alertSilences } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { extractInstanceLabels, parseLabels } from "@/server/alerts/instances";
import {
  ALERT_CHANNELS,
  type AlertDeliveryTargets,
  DeliverySettingsSchema,
  normalizeDeliverySettings,
} from "./delivery-settings";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  validateMatchers,
} from "./matchers";
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

export type AlertSummary = {
  id: string;
  repoid: string;
  slug: string;
  evaluationIntervalSeconds: number;
  sourceLink: string;
  configFilePath: string;
  currentState: "unknown" | "resolved" | "firing";
  active: boolean;
  validationStatus: string;
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
};

type AlertDetail = AlertSummary & {
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
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

type AlertSummaryRow = Omit<AlertSummary, "activeSilenceCount"> & {
  activeSilenceCount: number | string;
};

const alertIdInput = z.object({ alertId: z.string().uuid() });

// Subquery instead of a join: a rule can have several active silences and a
// join would duplicate list rows.
const activeSilenceCountSql = sql<number>`(
  select count(*)::int
  from alert_silences s
  where s.alert_definition_id = ${alertDefinitions.id}
    and s.starts_at <= now()
    and s.ends_at > now()
    and s.cancelled_at is null
)`.as("active_silence_count");

const alertListColumns = {
  id: alertDefinitions.id,
  repoid: alertDefinitions.repoid,
  slug: alertDefinitions.slug,
  evaluationIntervalSeconds: alertDefinitions.evaluationIntervalSeconds,
  sourceLink: alertDefinitions.sourceLink,
  configFilePath: alertDefinitions.configFilePath,
  currentState: alertDefinitions.currentState,
  active: alertDefinitions.active,
  validationStatus: alertDefinitions.validationStatus,
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
  return {
    ...row,
    lastEvidenceSnapshot: row.lastEvidenceSnapshot ?? [],
    activeSilenceCount: Number(row.activeSilenceCount) || 0,
  };
}

function clickhouseIsoMillis(column: string): string {
  return `concat(formatDateTime(${column}, '%Y-%m-%dT%H:%i:%S', 'UTC'), '.', substring(formatDateTime(${column}, '%f', 'UTC'), 1, 3), 'Z')`;
}

async function getAlertRow(alertId: string, organizationId: string) {
  const [row] = await db
    .select({
      ...alertListColumns,
      rawYaml: alertDefinitions.rawYaml,
      parsedQuery: alertDefinitions.parsedQuery,
      summaryTemplate: alertDefinitions.summaryTemplate,
      descriptionTemplate: alertDefinitions.descriptionTemplate,
      instanceLabelColumns: alertDefinitions.instanceLabelColumns,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, alertId),
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
    .select(alertListColumns)
    .from(alertDefinitions)
    .where(eq(alertDefinitions.organizationId, organizationId))
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
      rawYaml: row.rawYaml,
      parsedQuery: row.parsedQuery,
      summaryTemplate: row.summaryTemplate,
      descriptionTemplate: row.descriptionTemplate,
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
	              organization_id,
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
	            WHERE organization_id = {organizationId:String}
	              AND repoid = {repoid:String}
	              AND slug = {slug:String}
	              AND alert_definition_id = {alertDefinitionId:String}
	              AND event_type NOT IN ('instance_fired', 'instance_resolved', 'delivery_attempt')
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
	                OR (history.event_type IN ('resolved', 'partial_resolved') AND instance_events.event_type = 'instance_resolved')
	            ) AS instanceLabelsJson
	          FROM history
	          LEFT JOIN app.alert_events AS instance_events
	            ON instance_events.organization_id = history.organization_id
	            AND instance_events.repoid = history.repoid
	            AND instance_events.slug = history.slug
	            AND instance_events.alert_definition_id = history.alert_definition_id
	            AND instance_events.evaluation_scheduled_at = history.evaluation_scheduled_at
	            AND instance_events.event_type IN ('instance_fired', 'instance_resolved')
	          GROUP BY
	            history.organization_id,
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
      : eventType === "resolved" || eventType === "partial_resolved"
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

function labelsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  state: "firing" | "resolved";
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastRow: Record<string, AlertEvidenceValue>;
  lastEvaluationRows: Record<string, AlertEvidenceValue>[];
  lastEvaluationSummary: string | null;
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
    .where(activeSilenceConditions(organizationId, alertId, new Date()))
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
        WHERE organization_id = {organizationId:String}
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
      // Labels per snapshot row are invariant across instances — extract once,
      // not once per instance × row.
      const snapshotRows = evidenceRows(
        alert.lastEvidenceSnapshot as AlertEvidenceValue | undefined,
      ).map((row) => ({
        row,
        labels: extractInstanceLabels(row, instanceLabelColumns),
      }));

      return rows.map((row) => {
        const labels = parseLabels(row.labelsJson);
        const state =
          row.lastEventType === "instance_fired" ? "firing" : "resolved";
        const lastEvaluationRows =
          state === "firing"
            ? snapshotRows
                .filter((entry) => labelsEqual(entry.labels, labels))
                .map((entry) => entry.row)
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
          lastEvaluationSummary: firstEvaluationRow
            ? renderMessage(alert.summaryTemplate, {
                rowCount: alert.lastRowCount,
                firstRow: firstEvaluationRow,
              })
            : null,
          lastEvaluationDescription:
            firstEvaluationRow && alert.descriptionTemplate
              ? renderMessage(alert.descriptionTemplate, {
                  rowCount: alert.lastRowCount,
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

  return { delivery: normalizeDeliverySettings(row?.delivery) };
});

export const updateAlertSettings = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ delivery: DeliverySettingsSchema }))
  .handler(async ({ data: { delivery }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const normalized = normalizeDeliverySettings(delivery);
    const now = new Date();

    await db
      .insert(alertSettings)
      .values({
        organizationId,
        delivery: normalized,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: alertSettings.organizationId,
        set: { delivery: normalized, updatedAt: now },
      });

    return { delivery: normalized };
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

export const deactivateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const [row] = await db
      .update(alertDefinitions)
      .set({
        active: false,
        nextEvaluationAt: null,
        updatedAt: new Date(),
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
  });

// Resumes scheduling immediately (the scanner picks the alert up on its next
// tick). Runtime state is kept — unlike an `everr apply` revival, the
// definition hasn't changed, and the next evaluation corrects a stale
// firing/resolved state anyway.
export const activateAlert = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin();
    const now = new Date();
    const [row] = await db
      .update(alertDefinitions)
      .set({
        active: true,
        nextEvaluationAt: now,
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
  });
