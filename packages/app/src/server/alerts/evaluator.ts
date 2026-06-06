import { db } from "@/db/client";
import { notifyAlertUpdate } from "@/db/notify";
import { querySqlApi } from "@/lib/clickhouse";
import { boundEvidenceRows } from "./parser";
import {
  type AlertDefinitionEvaluationRow,
  type AlertEventType,
  createAlertEvent,
  getAlertDefinitionForEvaluation,
  updateAlertState,
} from "./repository";
import { resolveRoutingRecipients } from "./routing";

type AlertJobInput = {
  alertDefinitionId: number;
  scheduledFor: string;
};

type TemplateContext = {
  rows: Array<Record<string, unknown>>;
  service: string;
  name: string;
  severity: string;
  routing: string;
};

export async function evaluateAlertJob(input: AlertJobInput): Promise<void> {
  const definition = await getAlertDefinitionForEvaluation({
    alertDefinitionId: input.alertDefinitionId,
  });
  if (!definition?.active) {
    return;
  }

  const scheduledFor = new Date(input.scheduledFor);

  try {
    const rows = await querySqlApi<Record<string, unknown>>(
      renderStoredAlertQuery(definition),
      definition.organizationId,
    );
    const evidence = boundEvidenceRows(rows);
    const evaluatedAt = new Date();
    const transition = await updateAlertState({
      alertDefinitionId: definition.id,
      organizationId: definition.organizationId,
      evaluatedAt,
      rowCount: rows.length,
      evidence: evidence.rows,
      evidenceTruncated: evidence.truncated,
    });

    if (!transition.eventType) {
      return;
    }

    await createAndNotifyEvent({
      definition,
      eventType: transition.eventType,
      scheduledFor,
      rows,
      evidence: evidence.rows,
      evidenceTruncated: evidence.truncated,
      errorMessage: null,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Alert evaluation failed.";
    const evaluatedAt = new Date();
    const transition = await updateAlertState({
      alertDefinitionId: definition.id,
      organizationId: definition.organizationId,
      evaluatedAt,
      rowCount: 0,
      evidence: [],
      evidenceTruncated: false,
      errorMessage,
    });

    if (!transition.eventType) {
      return;
    }

    await createAndNotifyEvent({
      definition,
      eventType: transition.eventType,
      scheduledFor,
      rows: [],
      evidence: [],
      evidenceTruncated: false,
      errorMessage,
    });
  }
}

async function createAndNotifyEvent(input: {
  definition: AlertDefinitionEvaluationRow;
  eventType: AlertEventType;
  scheduledFor: Date;
  rows: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  evidenceTruncated: boolean;
  errorMessage: string | null;
}) {
  const summary =
    input.eventType === "evaluation_failed"
      ? `Alert evaluation failed for ${input.definition.service}/${input.definition.name}`
      : renderTemplate(input.definition.summaryTemplate, {
          rows: input.rows,
          service: input.definition.service,
          name: input.definition.name,
          severity: input.definition.severity,
          routing: input.definition.routingSlug,
        });
  const description =
    input.eventType === "evaluation_failed"
      ? input.errorMessage
      : renderOptionalTemplate(input.definition.descriptionTemplate, {
          rows: input.rows,
          service: input.definition.service,
          name: input.definition.name,
          severity: input.definition.severity,
          routing: input.definition.routingSlug,
        });

  const event = await createAlertEvent({
    alertDefinitionId: input.definition.id,
    organizationId: input.definition.organizationId,
    type: input.eventType,
    evaluationScheduledFor: input.scheduledFor,
    summary,
    description,
    rowCount: input.rows.length,
    evidence: input.evidence,
    evidenceTruncated: input.evidenceTruncated,
    errorMessage: input.errorMessage,
  });

  const recipientUserIds = await resolveRoutingRecipients({
    organizationId: input.definition.organizationId,
    slug: input.definition.routingSlug,
  });

  await notifyAlertUpdate(
    db as unknown as Parameters<typeof notifyAlertUpdate>[0],
    {
      kind: "alert",
      tenantId: input.definition.organizationId,
      recipientUserIds,
      alertDefinitionId: input.definition.id,
      alertEventId: event.id,
      service: input.definition.service,
      name: input.definition.name,
      severity: input.definition.severity,
      status: input.eventType,
      summary: event.summary,
      description: event.description,
      occurredAt:
        event.occurredAt instanceof Date
          ? event.occurredAt.toISOString()
          : String(event.occurredAt),
      sourceUrl: input.definition.sourceUrl,
      rowCount: event.rowCount,
    },
  );
}

function renderStoredAlertQuery(
  definition: AlertDefinitionEvaluationRow,
): string {
  return definition.query.replace(
    /{{\s*window\s*}}/g,
    clickHouseIntervalFromSeconds(definition.windowSeconds),
  );
}

function clickHouseIntervalFromSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) {
    return `${seconds / 86_400} DAY`;
  }
  if (seconds % 3_600 === 0) {
    return `${seconds / 3_600} HOUR`;
  }
  return `${seconds / 60} MINUTE`;
}

function renderOptionalTemplate(
  template: string | null,
  context: TemplateContext,
): string | null {
  return template ? renderTemplate(template, context) : null;
}

function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_match, rawPath) =>
    String(resolveTemplatePath(String(rawPath).trim(), context)),
  );
}

function resolveTemplatePath(path: string, context: TemplateContext): unknown {
  switch (path) {
    case "rows.length":
      return context.rows.length;
    case "service":
      return context.service;
    case "name":
      return context.name;
    case "severity":
      return context.severity;
    case "routing":
      return context.routing;
  }

  const rowPath = /^rows\.(\d+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path);
  if (!rowPath) {
    return "";
  }

  const row = context.rows[Number(rowPath[1])];
  const value = row?.[rowPath[2]];
  return value ?? "";
}
