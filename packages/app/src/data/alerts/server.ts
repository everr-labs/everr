import * as z from "zod";
import { pool } from "@/db/client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  deactivateAlertDefinition,
  listActiveAlertStates,
  listAlertEvents,
  listAlertRules,
  listRoutingLists,
  saveCustomRoutingList,
} from "@/server/alerts/repository";
import {
  type ActiveAlertListItem,
  type AlertEventListItem,
  type AlertEvidenceRow,
  type AlertEvidenceValue,
  type AlertRuleListItem,
  type RoutingListItem,
  SaveRoutingListInputSchema,
} from "./schemas";

const ALERT_MANAGER_ROLES = new Set(["admin", "owner"]);

type ServerSession = {
  session: {
    activeOrganizationId: string;
    userId?: string;
  };
  user?: {
    id?: string;
  };
};

export const getAlertRules = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ active: z.boolean().optional() }))
  .handler(async ({ data, context: { session } }) => {
    const rows = await listAlertRules({
      organizationId: session.session.activeOrganizationId,
      active: data.active,
    });

    return rows.map((row) => ({
      id: row.id,
      service: row.service,
      name: row.name,
      severity: row.severity,
      routingSlug: row.routingSlug,
      evaluationIntervalSeconds: row.evaluationIntervalSeconds,
      windowSeconds: row.windowSeconds,
      active: row.active,
      sourceUrl: row.sourceUrl,
      lastEvaluationStatus: row.lastEvaluationStatus,
      lastEvaluationError: row.lastEvaluationError,
      stateStatus: row.stateStatus,
      updatedAt: toIso(row.updatedAt),
    })) satisfies AlertRuleListItem[];
  });

export const getActiveAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({}))
  .handler(async ({ context: { session } }) => {
    const rows = await listActiveAlertStates({
      organizationId: session.session.activeOrganizationId,
    });

    return rows.map((row) => ({
      alertDefinitionId: row.alertDefinitionId,
      service: row.service,
      name: row.name,
      severity: row.severity,
      routingSlug: row.routingSlug,
      status: row.status,
      firstFiredAt: toIsoOrNull(row.firstFiredAt),
      lastSeenAt: toIsoOrNull(row.lastSeenAt),
      rowCount: row.rowCount,
      evidence: serializeEvidence(row.evidence),
      evidenceTruncated: row.evidenceTruncated,
      sourceUrl: row.sourceUrl,
    })) satisfies ActiveAlertListItem[];
  });

export const getAlertEvents = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const rows = await listAlertEvents({
      organizationId: session.session.activeOrganizationId,
      limit: data.limit ?? 50,
    });

    return rows.map((row) => ({
      id: row.id,
      alertDefinitionId: row.alertDefinitionId,
      service: row.service,
      name: row.name,
      severity: row.severity,
      type: row.type,
      summary: row.summary,
      description: row.description,
      occurredAt: toIso(row.occurredAt),
      rowCount: row.rowCount,
      sourceUrl: row.sourceUrl,
    })) satisfies AlertEventListItem[];
  });

export const getRoutingLists = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({}))
  .handler(async ({ context: { session } }) => {
    return (await listRoutingLists({
      organizationId: session.session.activeOrganizationId,
    })) satisfies RoutingListItem[];
  });

export const getAlertManagementAccess = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({}))
  .handler(async ({ context: { session } }) => {
    const userId = actorUserId(session);
    const role = await getMemberRole({
      organizationId: session.session.activeOrganizationId,
      userId,
    });

    return { canManage: ALERT_MANAGER_ROLES.has(role ?? "") };
  });

export const saveRoutingList = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(SaveRoutingListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const actorId = actorUserId(session);
    await requireAlertManager({
      organizationId: session.session.activeOrganizationId,
      userId: actorId,
    });

    return await saveCustomRoutingList({
      organizationId: session.session.activeOrganizationId,
      actorUserId: actorId,
      slug: data.slug,
      name: data.name,
      userIds: data.userIds,
    });
  });

export const deactivateAlertRule = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context: { session } }) => {
    const actorId = actorUserId(session);
    await requireAlertManager({
      organizationId: session.session.activeOrganizationId,
      userId: actorId,
    });

    return await deactivateAlertDefinition({
      organizationId: session.session.activeOrganizationId,
      actorUserId: actorId,
      id: data.id,
    });
  });

function actorUserId(session: ServerSession): string {
  const userId = session.user?.id ?? session.session.userId;
  if (!userId) {
    throw new Error("Authenticated user id is missing.");
  }
  return userId;
}

async function requireAlertManager(input: {
  organizationId: string;
  userId: string;
}) {
  const role = await getMemberRole(input);
  if (!ALERT_MANAGER_ROLES.has(role ?? "")) {
    throw new Error("Only organization admins can manage alerts.");
  }
}

async function getMemberRole(input: {
  organizationId: string;
  userId: string;
}): Promise<string | null> {
  const result = await pool.query<{ role: string }>(
    `
      SELECT role
      FROM member
      WHERE organization_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [input.organizationId, input.userId],
  );

  return result.rows[0]?.role ?? null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value ? toIso(value) : null;
}

function serializeEvidence(
  rows: Array<Record<string, unknown>>,
): AlertEvidenceRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        serializeEvidenceValue(value),
      ]),
    ),
  );
}

function serializeEvidenceValue(value: unknown): AlertEvidenceValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}
