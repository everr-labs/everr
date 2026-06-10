import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { alertDefinitions, alertSettings, alertSilences } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  validateMatchers,
} from "./matchers";

const DeliverySettingsSchema = z
  .object({
    email: z
      .object({
        enabled: z.boolean(),
        to: z.array(z.string().email()).default([]),
      })
      .strict()
      .optional(),
    telegram: z
      .object({
        enabled: z.boolean(),
        chatIds: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
    notifyOnResolved: z.boolean().optional(),
  })
  .strict();

type AlertDeliverySettings = z.infer<typeof DeliverySettingsSchema>;

const DEFAULT_DELIVERY_SETTINGS: Required<AlertDeliverySettings> = {
  email: { enabled: false, to: [] },
  telegram: { enabled: false, chatIds: [] },
  notifyOnResolved: true,
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
  window: string;
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

export type AlertDetail = AlertSummary & {
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
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
  deliveryTargetType: string;
  deliveryOutcome: string;
  silenceId: string;
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
  window: alertDefinitions.window,
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

async function ensureOrgAdmin(userId: string, organizationId: string) {
  const org = await auth.api.getFullOrganization({
    headers: getRequestHeaders(),
    query: { organizationId },
  });
  const membership = org?.members.find((member) => member.userId === userId);
  if (membership?.role !== "admin" && membership?.role !== "owner") {
    throw new Error("Only organization admins can manage alerts");
  }
}

function normalizeDeliverySettings(
  delivery: AlertDeliverySettings | null | undefined,
): Required<AlertDeliverySettings> {
  return {
    email: {
      enabled:
        delivery?.email?.enabled ?? DEFAULT_DELIVERY_SETTINGS.email.enabled,
      to: delivery?.email?.to ?? DEFAULT_DELIVERY_SETTINGS.email.to,
    },
    telegram: {
      enabled:
        delivery?.telegram?.enabled ??
        DEFAULT_DELIVERY_SETTINGS.telegram.enabled,
      chatIds:
        delivery?.telegram?.chatIds ??
        DEFAULT_DELIVERY_SETTINGS.telegram.chatIds,
    },
    notifyOnResolved:
      delivery?.notifyOnResolved ?? DEFAULT_DELIVERY_SETTINGS.notifyOnResolved,
  };
}

function toAlertSummary(row: AlertSummaryRow): AlertSummary {
  return {
    id: row.id,
    repoid: row.repoid,
    slug: row.slug,
    evaluationIntervalSeconds: row.evaluationIntervalSeconds,
    window: row.window,
    sourceLink: row.sourceLink,
    configFilePath: row.configFilePath,
    currentState: row.currentState,
    active: row.active,
    validationStatus: row.validationStatus,
    lastEvaluationStatus: row.lastEvaluationStatus,
    lastEvaluationError: row.lastEvaluationError,
    lastEvaluatedAt: row.lastEvaluatedAt,
    lastFiredAt: row.lastFiredAt,
    lastResolvedAt: row.lastResolvedAt,
    lastSeenAt: row.lastSeenAt,
    lastRowCount: row.lastRowCount,
    lastEvidenceSnapshot: row.lastEvidenceSnapshot ?? [],
    firingInstanceCount: row.firingInstanceCount,
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
    } satisfies AlertDetail;
  });

export const listAlertEvents = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    alertIdInput.extend({
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(
    async ({ data: { alertId, limit }, context: { session, clickhouse } }) => {
      const organizationId = session.session.activeOrganizationId;
      const alert = await getAlertRow(alertId, organizationId);
      if (!alert) throw new Error("Alert not found");

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
        deliveryTargetType: string;
        deliveryOutcome: string;
        silenceId: string;
      }>(
        `
          SELECT
            toString(event_id) AS eventId,
            alert_definition_id AS alertDefinitionId,
            repoid,
            slug,
            event_type AS eventType,
            ${clickhouseIsoMillis("event_time")} AS eventTime,
            if(evaluation_scheduled_at = toDateTime64(0, 3), '', ${clickhouseIsoMillis("evaluation_scheduled_at")}) AS evaluationScheduledAt,
            row_count AS rowCount,
            evidence_truncated AS evidenceTruncated,
            evidence_json AS evidenceJson,
            delivery_target_type AS deliveryTargetType,
            delivery_outcome AS deliveryOutcome,
            silence_id AS silenceId
          FROM app.alert_events
          WHERE organization_id = {organizationId:String}
            AND repoid = {repoid:String}
            AND slug = {slug:String}
            AND alert_definition_id = {alertDefinitionId:String}
            AND event_type NOT IN ('instance_fired', 'instance_resolved')
          ORDER BY event_time DESC, event_id DESC
          LIMIT {limit:UInt32}
        `,
        {
          organizationId,
          repoid: alert.repoid,
          slug: alert.slug,
          alertDefinitionId: alert.id,
          limit,
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
        deliveryTargetType: row.deliveryTargetType,
        deliveryOutcome: row.deliveryOutcome,
        silenceId: row.silenceId,
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

function parseJsonRecord(json: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseJsonObject(json)).map(([k, v]) => [k, String(v)]),
  );
}

export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  state: "firing" | "resolved";
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastRow: Record<string, unknown>;
  silenced: boolean;
};

async function listActiveSilenceRows(alertId: string, organizationId: string) {
  const now = new Date();
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
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        eq(alertSilences.alertDefinitionId, alertId),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
        isNull(alertSilences.cancelledAt),
      ),
    )
    .orderBy(desc(alertSilences.endsAt));
}

export const listAlertInstances = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session, clickhouse } }) => {
    const organizationId = session.session.activeOrganizationId;
    const alert = await getAlertRow(alertId, organizationId);
    if (!alert) throw new Error("Alert not found");

    const silences = await listActiveSilenceRows(alertId, organizationId);

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
        GROUP BY instance_fingerprint
        ORDER BY (lastEventType = 'instance_fired') DESC, max(event_time) DESC
        LIMIT 500
      `,
      {
        organizationId,
        repoid: alert.repoid,
        slug: alert.slug,
        alertDefinitionId: alert.id,
      },
    );

    return rows.map((row) => {
      const labels = parseJsonRecord(row.labelsJson);
      return {
        fingerprint: row.fingerprint,
        labels,
        state: row.lastEventType === "instance_fired" ? "firing" : "resolved",
        lastFiredAt: row.lastFiredAt || null,
        lastResolvedAt: row.lastResolvedAt || null,
        lastRow: parseJsonObject(row.lastFiredEvidenceJson),
        silenced: Boolean(findSilenceForInstance(silences, labels)),
      } satisfies AlertInstanceSummary;
    });
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
    const parsedDelivery = DeliverySettingsSchema.parse(delivery);
    const organizationId = session.session.activeOrganizationId;
    await ensureOrgAdmin(session.user.id, organizationId);
    const normalized = normalizeDeliverySettings(parsedDelivery);
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
      await ensureOrgAdmin(session.user.id, organizationId);
      const alert = await getAlertRow(alertId, organizationId);
      if (!alert) throw new Error("Alert not found");

      const silenceMatchers = matchers ?? [];
      validateMatchers(silenceMatchers);

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
          matchers: silenceMatchers,
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
    await ensureOrgAdmin(session.user.id, organizationId);
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
    await ensureOrgAdmin(session.user.id, organizationId);
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
