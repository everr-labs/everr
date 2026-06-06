import { pool } from "@/db/client";

export type AlertSeverity = "critical" | "warning";
export type AlertStateStatus = "inactive" | "firing" | "resolved";
export type AlertEventType = "firing" | "resolved" | "evaluation_failed";

export type AlertDefinitionUpsert = {
  service: string;
  name: string;
  severity: AlertSeverity;
  routing: string;
  evaluationIntervalSeconds: number;
  windowSeconds: number;
  query: string;
  summary: string;
  description: string | null;
};

export type UpsertAlertDefinitionsInput = {
  organizationId: string;
  rawYaml: string;
  sourceUrl: string;
  sourceRepo?: string | null;
  sourceBranch?: string | null;
  sourceCommitSha?: string | null;
  sourceRemote?: string | null;
  sourcePath?: string | null;
  userId: string;
  now?: Date;
  alerts: AlertDefinitionUpsert[];
};

export type UpsertAlertDefinitionsResult = {
  uploaded: number;
  deactivated: number;
};

export type AlertRuleRow = {
  id: number;
  organizationId: string;
  service: string;
  name: string;
  severity: AlertSeverity;
  routingSlug: string;
  evaluationIntervalSeconds: number;
  windowSeconds: number;
  sourceUrl: string;
  sourceRepo: string | null;
  sourceBranch: string | null;
  sourceCommitSha: string | null;
  sourcePath: string | null;
  active: boolean;
  validationStatus: string;
  lastEvaluationStatus: string | null;
  lastEvaluationError: string | null;
  stateStatus: AlertStateStatus | null;
  updatedAt: Date;
};

export type AlertDefinitionEvaluationRow = {
  id: number;
  organizationId: string;
  service: string;
  name: string;
  severity: AlertSeverity;
  routingSlug: string;
  evaluationIntervalSeconds: number;
  windowSeconds: number;
  active: boolean;
  query: string;
  summaryTemplate: string;
  descriptionTemplate: string | null;
  sourceUrl: string;
};

export type ClaimedAlertDefinition = {
  alertDefinitionId: number;
  organizationId: string;
  scheduledFor: Date;
};

export type AlertStateTransitionInput = {
  alertDefinitionId: number;
  organizationId: string;
  evaluatedAt: Date;
  rowCount: number;
  evidence: Array<Record<string, unknown>>;
  evidenceTruncated: boolean;
  errorMessage?: string | null;
};

export type AlertStateTransitionResult = {
  eventType: AlertEventType | null;
  previousStatus: AlertStateStatus | null;
  currentStatus: AlertStateStatus;
};

export type CreateAlertEventInput = {
  alertDefinitionId: number;
  organizationId: string;
  type: AlertEventType;
  evaluationScheduledFor: Date;
  summary: string;
  description: string | null;
  rowCount: number;
  evidence: Array<Record<string, unknown>>;
  evidenceTruncated: boolean;
  errorMessage?: string | null;
};

export type AlertEventRow = CreateAlertEventInput & {
  id: number;
  occurredAt: Date;
};

type StateRow = {
  status: AlertStateStatus;
};

export async function upsertAlertDefinitions(
  input: UpsertAlertDefinitionsInput,
): Promise<UpsertAlertDefinitionsResult> {
  const now = input.now ?? new Date();
  const namesByService = new Map<string, string[]>();

  for (const alert of input.alerts) {
    const names = namesByService.get(alert.service) ?? [];
    names.push(alert.name);
    namesByService.set(alert.service, names);

    await pool.query(
      `
        INSERT INTO alert_definitions (
          organization_id,
          service,
          name,
          severity,
          routing_slug,
          evaluation_interval_seconds,
          window_seconds,
          next_evaluation_at,
          raw_yaml,
          query,
          summary_template,
          description_template,
          source_url,
          source_repo,
          source_branch,
          source_commit_sha,
          source_remote,
          source_path,
          created_by_user_id,
          updated_by_user_id,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
        ON CONFLICT (organization_id, service, name)
        DO UPDATE SET
          severity = EXCLUDED.severity,
          routing_slug = EXCLUDED.routing_slug,
          evaluation_interval_seconds = EXCLUDED.evaluation_interval_seconds,
          window_seconds = EXCLUDED.window_seconds,
          next_evaluation_at = EXCLUDED.next_evaluation_at,
          raw_yaml = EXCLUDED.raw_yaml,
          query = EXCLUDED.query,
          summary_template = EXCLUDED.summary_template,
          description_template = EXCLUDED.description_template,
          source_url = EXCLUDED.source_url,
          source_repo = EXCLUDED.source_repo,
          source_branch = EXCLUDED.source_branch,
          source_commit_sha = EXCLUDED.source_commit_sha,
          source_remote = EXCLUDED.source_remote,
          source_path = EXCLUDED.source_path,
          active = true,
          validation_status = 'valid',
          last_evaluation_error = NULL,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.organizationId,
        alert.service,
        alert.name,
        alert.severity,
        alert.routing,
        alert.evaluationIntervalSeconds,
        alert.windowSeconds,
        now,
        input.rawYaml,
        alert.query,
        alert.summary,
        alert.description,
        input.sourceUrl,
        input.sourceRepo ?? null,
        input.sourceBranch ?? null,
        input.sourceCommitSha ?? null,
        input.sourceRemote ?? null,
        input.sourcePath ?? null,
        input.userId,
        input.userId,
        now,
      ],
    );
  }

  let deactivated = 0;
  for (const [service, names] of namesByService) {
    const result = await pool.query(
      `
        UPDATE alert_definitions
        SET
          active = false,
          updated_by_user_id = $5,
          updated_at = $6
        WHERE organization_id = $1
          AND service = $2
          AND source_url = $3
          AND name <> ALL($4::text[])
          AND active = true
      `,
      [
        input.organizationId,
        service,
        input.sourceUrl,
        names,
        input.userId,
        now,
      ],
    );
    deactivated += result.rowCount ?? 0;
  }

  return {
    uploaded: input.alerts.length,
    deactivated,
  };
}

export async function listAlertRules(input: {
  organizationId: string;
}): Promise<AlertRuleRow[]> {
  const result = await pool.query<AlertRuleRow>(
    `
      SELECT
        d.id,
        d.organization_id AS "organizationId",
        d.service,
        d.name,
        d.severity,
        d.routing_slug AS "routingSlug",
        d.evaluation_interval_seconds AS "evaluationIntervalSeconds",
        d.window_seconds AS "windowSeconds",
        d.source_url AS "sourceUrl",
        d.source_repo AS "sourceRepo",
        d.source_branch AS "sourceBranch",
        d.source_commit_sha AS "sourceCommitSha",
        d.source_path AS "sourcePath",
        d.active,
        d.validation_status AS "validationStatus",
        d.last_evaluation_status AS "lastEvaluationStatus",
        d.last_evaluation_error AS "lastEvaluationError",
        s.status AS "stateStatus",
        d.updated_at AS "updatedAt"
      FROM alert_definitions d
      LEFT JOIN alert_states s
        ON s.alert_definition_id = d.id
      WHERE d.organization_id = $1
      ORDER BY d.service ASC, d.name ASC
    `,
    [input.organizationId],
  );

  return result.rows;
}

export async function getAlertDefinitionForEvaluation(input: {
  alertDefinitionId: number;
}): Promise<AlertDefinitionEvaluationRow | null> {
  const result = await pool.query<AlertDefinitionEvaluationRow>(
    `
      SELECT
        id,
        organization_id AS "organizationId",
        service,
        name,
        severity,
        routing_slug AS "routingSlug",
        evaluation_interval_seconds AS "evaluationIntervalSeconds",
        window_seconds AS "windowSeconds",
        active,
        query,
        summary_template AS "summaryTemplate",
        description_template AS "descriptionTemplate",
        source_url AS "sourceUrl"
      FROM alert_definitions
      WHERE id = $1
    `,
    [input.alertDefinitionId],
  );

  return result.rows[0] ?? null;
}

export async function claimDueAlertDefinitions(input: {
  limit: number;
  now: Date;
}): Promise<ClaimedAlertDefinition[]> {
  const result = await pool.query<ClaimedAlertDefinition>(
    `
      WITH due AS (
        SELECT
          id,
          organization_id,
          next_evaluation_at,
          evaluation_interval_seconds,
          schedule_jitter_seconds
        FROM alert_definitions
        WHERE active = true
          AND next_evaluation_at <= $1
        ORDER BY next_evaluation_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE alert_definitions d
      SET
        last_enqueued_at = $1,
        next_evaluation_at = $1 + make_interval(
          secs => due.evaluation_interval_seconds + due.schedule_jitter_seconds
        )
      FROM due
      WHERE d.id = due.id
      RETURNING
        d.id AS "alertDefinitionId",
        d.organization_id AS "organizationId",
        due.next_evaluation_at AS "scheduledFor"
    `,
    [input.now, input.limit],
  );

  return result.rows;
}

export async function updateAlertState(
  input: AlertStateTransitionInput,
): Promise<AlertStateTransitionResult> {
  const previousStatus = await loadPreviousStatus(input.alertDefinitionId);

  if (input.errorMessage) {
    await pool.query(
      `
        UPDATE alert_definitions
        SET
          last_evaluation_status = 'failed',
          last_evaluation_error = $2,
          updated_at = $3
        WHERE id = $1
      `,
      [input.alertDefinitionId, input.errorMessage, input.evaluatedAt],
    );

    return {
      eventType: "evaluation_failed",
      previousStatus,
      currentStatus: previousStatus ?? "inactive",
    };
  }

  await pool.query(
    `
      UPDATE alert_definitions
      SET
        last_evaluation_status = 'success',
        last_evaluation_error = NULL,
        updated_at = $2
      WHERE id = $1
    `,
    [input.alertDefinitionId, input.evaluatedAt],
  );

  if (input.rowCount > 0) {
    await upsertFiringState(input);
    return {
      eventType: previousStatus === "firing" ? null : "firing",
      previousStatus,
      currentStatus: "firing",
    };
  }

  if (previousStatus === "firing") {
    await resolveFiringState(input);
    return {
      eventType: "resolved",
      previousStatus,
      currentStatus: "resolved",
    };
  }

  await upsertInactiveState(input, previousStatus ?? "inactive");
  return {
    eventType: null,
    previousStatus,
    currentStatus: previousStatus ?? "inactive",
  };
}

export async function createAlertEvent(
  input: CreateAlertEventInput,
): Promise<AlertEventRow> {
  const result = await pool.query<AlertEventRow>(
    `
      INSERT INTO alert_events (
        alert_definition_id,
        organization_id,
        type,
        evaluation_scheduled_for,
        summary,
        description,
        row_count,
        evidence,
        evidence_truncated,
        error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (
        alert_definition_id,
        evaluation_scheduled_for,
        type
      )
      DO UPDATE SET
        summary = EXCLUDED.summary,
        description = EXCLUDED.description,
        row_count = EXCLUDED.row_count,
        evidence = EXCLUDED.evidence,
        evidence_truncated = EXCLUDED.evidence_truncated,
        error_message = EXCLUDED.error_message
      RETURNING
        id,
        alert_definition_id AS "alertDefinitionId",
        organization_id AS "organizationId",
        type,
        evaluation_scheduled_for AS "evaluationScheduledFor",
        occurred_at AS "occurredAt",
        summary,
        description,
        row_count AS "rowCount",
        evidence,
        evidence_truncated AS "evidenceTruncated",
        error_message AS "errorMessage"
    `,
    [
      input.alertDefinitionId,
      input.organizationId,
      input.type,
      input.evaluationScheduledFor,
      input.summary,
      input.description,
      input.rowCount,
      JSON.stringify(input.evidence),
      input.evidenceTruncated,
      input.errorMessage ?? null,
    ],
  );

  const event = result.rows[0];
  if (!event) {
    throw new Error("alert event insert returned no rows");
  }

  return event;
}

export async function deleteExpiredAlertEvents(input: {
  olderThan: Date;
  limit: number;
}): Promise<number> {
  const result = await pool.query(
    `
      WITH expired AS (
        SELECT id
        FROM alert_events
        WHERE occurred_at < $1
        ORDER BY occurred_at ASC
        LIMIT $2
      )
      DELETE FROM alert_events
      WHERE id IN (SELECT id FROM expired)
    `,
    [input.olderThan, input.limit],
  );

  return result.rowCount ?? 0;
}

async function loadPreviousStatus(
  alertDefinitionId: number,
): Promise<AlertStateStatus | null> {
  const result = await pool.query<StateRow>(
    `
      SELECT status
      FROM alert_states
      WHERE alert_definition_id = $1
    `,
    [alertDefinitionId],
  );

  return result.rows[0]?.status ?? null;
}

async function upsertFiringState(input: AlertStateTransitionInput) {
  await pool.query(
    `
      INSERT INTO alert_states (
        alert_definition_id,
        organization_id,
        status,
        first_fired_at,
        last_seen_at,
        last_evaluated_at,
        row_count,
        evidence,
        evidence_truncated,
        updated_at
      )
      VALUES ($1, $2, 'firing', $3, $3, $3, $4, $5::jsonb, $6, $3)
      ON CONFLICT (alert_definition_id)
      DO UPDATE SET
        status = 'firing',
        first_fired_at = COALESCE(alert_states.first_fired_at, EXCLUDED.first_fired_at),
        last_seen_at = EXCLUDED.last_seen_at,
        last_evaluated_at = EXCLUDED.last_evaluated_at,
        resolved_at = NULL,
        row_count = EXCLUDED.row_count,
        evidence = EXCLUDED.evidence,
        evidence_truncated = EXCLUDED.evidence_truncated,
        updated_at = EXCLUDED.updated_at
    `,
    [
      input.alertDefinitionId,
      input.organizationId,
      input.evaluatedAt,
      input.rowCount,
      JSON.stringify(input.evidence),
      input.evidenceTruncated,
    ],
  );
}

async function resolveFiringState(input: AlertStateTransitionInput) {
  await pool.query(
    `
      UPDATE alert_states
      SET
        status = 'resolved',
        resolved_at = $2,
        last_evaluated_at = $2,
        row_count = 0,
        evidence = '[]'::jsonb,
        evidence_truncated = false,
        updated_at = $2
      WHERE alert_definition_id = $1
    `,
    [input.alertDefinitionId, input.evaluatedAt],
  );
}

async function upsertInactiveState(
  input: AlertStateTransitionInput,
  status: AlertStateStatus,
) {
  await pool.query(
    `
      INSERT INTO alert_states (
        alert_definition_id,
        organization_id,
        status,
        last_evaluated_at,
        row_count,
        evidence,
        evidence_truncated,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 0, '[]'::jsonb, false, $4)
      ON CONFLICT (alert_definition_id)
      DO UPDATE SET
        last_evaluated_at = EXCLUDED.last_evaluated_at,
        row_count = 0,
        evidence = '[]'::jsonb,
        evidence_truncated = false,
        updated_at = EXCLUDED.updated_at
    `,
    [input.alertDefinitionId, input.organizationId, status, input.evaluatedAt],
  );
}
