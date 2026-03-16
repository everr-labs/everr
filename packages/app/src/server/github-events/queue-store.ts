import type { Pool } from "pg";
import { pool } from "@/db/client";
import { GH_EVENTS_CONFIG } from "./config";
import type {
  EnqueueStatus,
  FinalizeResult,
  WebhookEventRecord,
  WebhookHeaders,
  WebhookTopic,
} from "./types";

export interface WebhookEventStore {
  enqueueEvent(args: {
    source: string;
    eventId: string;
    bodySha256: string;
    repositoryId?: number | null;
    topics: readonly WebhookTopic[];
    headers: WebhookHeaders;
    body: Buffer;
  }): Promise<EnqueueStatus>;
  claimEvents(): Promise<WebhookEventRecord[]>;
  renewEventLock(args: { eventId: number; attempts: number }): Promise<boolean>;
  finalizeEvent(args: {
    eventId: number;
    attempts: number;
    result: FinalizeResult;
    errorClass?: string;
    lastError?: string;
  }): Promise<boolean>;
  cleanup(): Promise<void>;
}

export function retryDelayMs(attempt: number): number {
  const safeAttempt = attempt < 1 ? 1 : attempt;
  const baseMs = Math.min(2 ** safeAttempt * 1000, 900_000);
  const jitter = Math.random() * 0.4 - 0.2;
  return Math.max(1000, Math.round(baseMs + baseMs * jitter));
}

function truncate(value: string | undefined, limit: number): string | null {
  if (!value) {
    return null;
  }
  return value.length <= limit ? value : value.slice(0, limit);
}

export class PostgresWebhookEventStore implements WebhookEventStore {
  private readonly db: Pool = pool;

  async enqueueEvent(args: {
    source: string;
    eventId: string;
    bodySha256: string;
    repositoryId?: number | null;
    topics: readonly WebhookTopic[];
    headers: WebhookHeaders;
    body: Buffer;
  }): Promise<EnqueueStatus> {
    if (args.topics.length === 0) {
      throw new Error("at least one topic is required");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      let insertedAny = false;
      let duplicateCount = 0;
      const headersJson = JSON.stringify(args.headers);

      for (const topic of args.topics) {
        const insertResult = await client.query(
          `
            INSERT INTO webhook_events (
              source,
              event_id,
              topic,
              body_sha256,
              repository_id,
              headers,
              body
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            ON CONFLICT (source, event_id, topic) DO NOTHING
          `,
          [
            args.source,
            args.eventId,
            topic,
            args.bodySha256,
            args.repositoryId ?? null,
            headersJson,
            args.body,
          ],
        );

        if (insertResult.rowCount && insertResult.rowCount > 0) {
          insertedAny = true;
          continue;
        }

        const existing = await client.query<{ body_sha256: string }>(
          `
            SELECT body_sha256
            FROM webhook_events
            WHERE source = $1 AND event_id = $2 AND topic = $3
          `,
          [args.source, args.eventId, topic],
        );

        const existingSha = existing.rows[0]?.body_sha256;
        if (existingSha !== args.bodySha256) {
          await client.query("ROLLBACK");
          return "conflict";
        }

        duplicateCount += 1;
      }

      await client.query("COMMIT");

      if (insertedAny) {
        return "inserted";
      }

      if (duplicateCount === args.topics.length) {
        return "duplicate";
      }

      throw new Error(`unexpected enqueue result for ${args.eventId}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimEvents(): Promise<WebhookEventRecord[]> {
    const result = await this.db.query<{
      id: string;
      source: string;
      event_id: string;
      topic: WebhookTopic;
      repository_id: string | null;
      headers: WebhookHeaders;
      body: Buffer;
      attempts: number;
    }>(
      `
        WITH cte AS (
          SELECT id
          FROM webhook_events
          WHERE status IN ('queued', 'failed')
            AND next_attempt_at <= now()
            AND (locked_until IS NULL OR locked_until <= now())
          ORDER BY received_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE webhook_events AS events
        SET status = 'processing',
            attempts = attempts + 1,
            locked_until = now() + ($2 * interval '1 millisecond')
        FROM cte
        WHERE events.id = cte.id
        RETURNING
          events.id,
          events.source,
          events.event_id,
          events.topic,
          events.repository_id,
          events.headers,
          events.body,
          events.attempts
      `,
      [GH_EVENTS_CONFIG.workerBatchSize, GH_EVENTS_CONFIG.lockDurationMs],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      source: row.source,
      eventId: row.event_id,
      topic: row.topic,
      repositoryId:
        row.repository_id === null ? null : Number(row.repository_id),
      headers: row.headers,
      body: row.body,
      attempts: row.attempts,
    }));
  }

  async renewEventLock(args: { eventId: number; attempts: number }) {
    const result = await this.db.query(
      `
        UPDATE webhook_events
        SET locked_until = now() + ($3 * interval '1 millisecond')
        WHERE id = $1
          AND attempts = $2
          AND status = 'processing'
      `,
      [args.eventId, args.attempts, GH_EVENTS_CONFIG.lockDurationMs],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async finalizeEvent(args: {
    eventId: number;
    attempts: number;
    result: FinalizeResult;
    errorClass?: string;
    lastError?: string;
  }) {
    if (args.result === "done") {
      const result = await this.db.query(
        `
          UPDATE webhook_events
          SET status = 'done',
              done_at = now(),
              locked_until = NULL,
              last_error = NULL,
              error_class = NULL
          WHERE id = $1
            AND attempts = $2
            AND status = 'processing'
        `,
        [args.eventId, args.attempts],
      );
      return (result.rowCount ?? 0) > 0;
    }

    if (args.result === "dead") {
      const result = await this.db.query(
        `
          UPDATE webhook_events
          SET status = 'dead',
              dead_at = now(),
              locked_until = NULL,
              next_attempt_at = now(),
              last_error = $3,
              error_class = $4
          WHERE id = $1
            AND attempts = $2
            AND status = 'processing'
        `,
        [
          args.eventId,
          args.attempts,
          truncate(args.lastError, 1024),
          args.errorClass ?? null,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    }

    const delayMs = retryDelayMs(args.attempts);
    const result = await this.db.query(
      `
        UPDATE webhook_events
        SET status = 'failed',
            locked_until = NULL,
            next_attempt_at = now() + ($3 * interval '1 millisecond'),
            last_error = $4,
            error_class = $5
        WHERE id = $1
          AND attempts = $2
          AND status = 'processing'
      `,
      [
        args.eventId,
        args.attempts,
        delayMs,
        truncate(args.lastError, 1024),
        args.errorClass ?? null,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async cleanup() {
    await this.cleanupStatus(
      "done",
      "done_at",
      GH_EVENTS_CONFIG.retentionDoneDays,
    );
    await this.cleanupStatus(
      "dead",
      "dead_at",
      GH_EVENTS_CONFIG.retentionDeadDays,
    );
  }

  private async cleanupStatus(
    status: "done" | "dead",
    timeField: "done_at" | "dead_at",
    retentionDays: number,
  ) {
    await this.db.query(
      `
        DELETE FROM webhook_events
        WHERE ctid IN (
          SELECT ctid
          FROM webhook_events
          WHERE status = $1
            AND ${timeField} IS NOT NULL
            AND ${timeField} < now() - ($2 * interval '1 day')
          LIMIT 500
        )
      `,
      [status, retentionDays],
    );
  }
}

let webhookEventStore: PostgresWebhookEventStore | undefined;

export function getWebhookEventStore(): PostgresWebhookEventStore {
  if (!webhookEventStore) {
    webhookEventStore = new PostgresWebhookEventStore();
  }

  return webhookEventStore;
}
