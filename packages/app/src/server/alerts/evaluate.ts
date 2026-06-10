import { eq } from "drizzle-orm";
import { renderMessage, renderQuery } from "@/data/alerts/template";
import { parseWindow } from "@/data/alerts/window";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { insertAlertEvents, querySqlApiWithMeta } from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { deliverAlertNotification } from "./delivery";
import { boundEvidence, buildEvaluationEvent } from "./events";
import type { EvaluatePayload } from "./scanner";
import { type AlertState, computeTransition } from "./transitions";

export async function evaluateAlert(payload: EvaluatePayload): Promise<void> {
  const [def] = await db
    .select()
    .from(alertDefinitions)
    .where(eq(alertDefinitions.id, payload.alertDefinitionId))
    .limit(1);
  if (!def?.active) return;

  const scheduledFor = new Date(payload.scheduledFor);
  const now = new Date();
  const query = renderQuery(def.parsedQuery, parseWindow(def.window).interval);

  let rows: Record<string, unknown>[];
  try {
    const result = await querySqlApiWithMeta<Record<string, unknown>>(
      query,
      def.organizationId,
    );
    rows = result.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(alertDefinitions)
      .set({
        lastEvaluationStatus: "error",
        lastEvaluationError: message,
        lastEvaluatedAt: now,
      })
      .where(eq(alertDefinitions.id, def.id));
    await insertAlertEvents([
      buildEvaluationEvent({
        def,
        eventType: "evaluation_failed",
        scheduledFor,
      }),
    ]);
    serverLogger.error("alerts.evaluate.query_failed", {
      ...exceptionAttributes(error),
      "alert.definition_id": def.id,
    });
    return;
  }

  const evidence = boundEvidence(rows);
  const transition = computeTransition(
    def.currentState as AlertState,
    evidence.rowCount,
  );
  const summary = renderMessage(def.summaryTemplate, {
    rowCount: evidence.rowCount,
    firstRow: evidence.firstRow,
  });
  const description = def.descriptionTemplate
    ? renderMessage(def.descriptionTemplate, {
        rowCount: evidence.rowCount,
        firstRow: evidence.firstRow,
      })
    : "";
  const baseUpdate = {
    lastEvaluationStatus: "ok",
    lastEvaluationError: "",
    lastEvaluatedAt: now,
    lastRowCount: evidence.rowCount,
    lastEvidenceSnapshot: evidence.rows,
  };

  if (transition === "fire") {
    await db
      .update(alertDefinitions)
      .set({
        ...baseUpdate,
        currentState: "firing",
        lastFiredAt: now,
        lastSeenAt: now,
      })
      .where(eq(alertDefinitions.id, def.id));
    await insertAlertEvents([
      buildEvaluationEvent({
        def,
        eventType: "firing",
        scheduledFor,
        evidence,
      }),
    ]);
    await deliverAlertNotification({
      def,
      kind: "firing",
      summary,
      description,
    });
    return;
  }

  if (transition === "still_firing") {
    await db
      .update(alertDefinitions)
      .set({ ...baseUpdate, lastSeenAt: now })
      .where(eq(alertDefinitions.id, def.id));
    return;
  }

  if (transition === "resolve") {
    await db
      .update(alertDefinitions)
      .set({
        ...baseUpdate,
        currentState: "resolved",
        lastResolvedAt: now,
      })
      .where(eq(alertDefinitions.id, def.id));
    await insertAlertEvents([
      buildEvaluationEvent({
        def,
        eventType: "resolved",
        scheduledFor,
        evidence,
      }),
    ]);
    await deliverAlertNotification({
      def,
      kind: "resolved",
      summary,
      description,
    });
    return;
  }

  await db
    .update(alertDefinitions)
    .set({ ...baseUpdate, currentState: "resolved" })
    .where(eq(alertDefinitions.id, def.id));
}
