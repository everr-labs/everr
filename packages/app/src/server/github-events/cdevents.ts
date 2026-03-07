import { createClient } from "@clickhouse/client";
import { getGitHubEventsConfig } from "./config";
import type { ParsedQueuedWorkflowEvent } from "./payloads";
import {
  mapConclusionToOutcome,
  parseQueuedWorkflowEvent,
  parseTimestamp,
  repositoryHTMLURL,
} from "./payloads";
import { TerminalEventError } from "./types";

const headerGitHubEvent = "x-github-event";
const headerGitHubDelivery = "x-github-delivery";
const headerTenantId = "x-everr-tenant-id";
const cdeventsSpecVersion = "0.4.1";

export type CDEventRow = {
  tenantId: number;
  deliveryId: string;
  eventKind: string;
  eventPhase: string;
  eventTime: Date;
  subjectId: string;
  subjectName: string;
  subjectURL: string;
  pipelineRunId: string;
  repository: string;
  sha: string;
  gitRef: string;
  outcome: string;
  cdeventJson: string;
};

export interface CDEventInserter {
  insert(rows: CDEventRow[]): Promise<void>;
}

type PendingCDEventsWrite = {
  rows: CDEventRow[];
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

export function formatClickHouseDateTime64(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

function buildCDEventJSON(args: {
  source: string;
  deliveryId: string;
  type: string;
  timestamp: Date;
  subjectId: string;
  content: Record<string, unknown>;
}): string {
  return JSON.stringify({
    context: {
      version: cdeventsSpecVersion,
    },
    id: args.deliveryId,
    source: args.source,
    type: args.type,
    timestamp: args.timestamp.toISOString(),
    subject: {
      id: args.subjectId,
      content: args.content,
    },
  });
}

function transformWorkflowRun(
  event: Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_run" }>,
  deliveryId: string,
  tenantId: number,
): CDEventRow[] {
  const workflowRun = event.payload.workflow_run;
  if (!workflowRun) {
    throw new TerminalEventError("workflow_run payload missing workflow_run");
  }

  const repositoryURL = repositoryHTMLURL(event.payload.repository);
  const repositoryName = event.payload.repository?.full_name ?? "";
  const subjectName = workflowRun.name ?? "";
  const subjectURL = workflowRun.html_url ?? "";
  const subjectId = String(workflowRun.id);
  const sha = workflowRun.head_sha ?? "";
  const gitRef = workflowRun.head_branch ?? "";

  if (event.payload.action === "requested") {
    const timestamp = parseTimestamp(
      workflowRun.created_at,
      workflowRun.updated_at,
      workflowRun.run_started_at,
    );
    return [
      {
        tenantId,
        deliveryId,
        eventKind: "pipelinerun",
        eventPhase: "queued",
        eventTime: timestamp,
        subjectId,
        subjectName,
        subjectURL,
        pipelineRunId: "",
        repository: repositoryName,
        sha,
        gitRef,
        outcome: "",
        cdeventJson: buildCDEventJSON({
          source: repositoryURL,
          deliveryId,
          type: "dev.cdevents.pipelinerun.queued.0.2.0",
          timestamp,
          subjectId,
          content: {
            pipelineName: subjectName,
            url: subjectURL,
          },
        }),
      },
    ];
  }

  if (event.payload.action === "in_progress") {
    const timestamp = parseTimestamp(
      workflowRun.run_started_at,
      workflowRun.updated_at,
      workflowRun.created_at,
    );
    return [
      {
        tenantId,
        deliveryId,
        eventKind: "pipelinerun",
        eventPhase: "started",
        eventTime: timestamp,
        subjectId,
        subjectName,
        subjectURL,
        pipelineRunId: "",
        repository: repositoryName,
        sha,
        gitRef,
        outcome: "",
        cdeventJson: buildCDEventJSON({
          source: repositoryURL,
          deliveryId,
          type: "dev.cdevents.pipelinerun.started.0.2.0",
          timestamp,
          subjectId,
          content: {
            pipelineName: subjectName,
            url: subjectURL,
          },
        }),
      },
    ];
  }

  if (event.payload.action === "completed") {
    const timestamp = parseTimestamp(
      workflowRun.updated_at,
      workflowRun.run_started_at,
      workflowRun.created_at,
    );
    const outcome = mapConclusionToOutcome(workflowRun.conclusion);
    return [
      {
        tenantId,
        deliveryId,
        eventKind: "pipelinerun",
        eventPhase: "finished",
        eventTime: timestamp,
        subjectId,
        subjectName,
        subjectURL,
        pipelineRunId: "",
        repository: repositoryName,
        sha,
        gitRef,
        outcome,
        cdeventJson: buildCDEventJSON({
          source: repositoryURL,
          deliveryId,
          type: "dev.cdevents.pipelinerun.finished.0.2.0",
          timestamp,
          subjectId,
          content: {
            pipelineName: subjectName,
            url: subjectURL,
            ...(outcome ? { outcome } : {}),
          },
        }),
      },
    ];
  }

  return [];
}

function transformWorkflowJob(
  event: Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_job" }>,
  deliveryId: string,
  tenantId: number,
): CDEventRow[] {
  const workflowJob = event.payload.workflow_job;
  if (!workflowJob) {
    throw new TerminalEventError("workflow_job payload missing workflow_job");
  }

  const repositoryURL = repositoryHTMLURL(event.payload.repository);
  const repositoryName = event.payload.repository?.full_name ?? "";
  const subjectName = workflowJob.name ?? "";
  const subjectURL = workflowJob.html_url ?? "";
  const subjectId = String(workflowJob.id);
  const pipelineRunId = String(workflowJob.run_id);
  const sha = workflowJob.head_sha ?? "";
  const gitRef = workflowJob.head_branch ?? "";

  if (event.payload.action === "in_progress") {
    const timestamp = parseTimestamp(
      workflowJob.started_at,
      workflowJob.created_at,
    );
    return [
      {
        tenantId,
        deliveryId,
        eventKind: "taskrun",
        eventPhase: "started",
        eventTime: timestamp,
        subjectId,
        subjectName,
        subjectURL,
        pipelineRunId,
        repository: repositoryName,
        sha,
        gitRef,
        outcome: "",
        cdeventJson: buildCDEventJSON({
          source: repositoryURL,
          deliveryId,
          type: "dev.cdevents.taskrun.started.0.2.0",
          timestamp,
          subjectId,
          content: {
            taskName: subjectName,
            url: subjectURL,
            pipelineRun: {
              id: pipelineRunId,
              source: repositoryURL,
            },
          },
        }),
      },
    ];
  }

  if (event.payload.action === "completed") {
    const timestamp = parseTimestamp(
      workflowJob.completed_at,
      workflowJob.started_at,
      workflowJob.created_at,
    );
    const outcome = mapConclusionToOutcome(workflowJob.conclusion);
    return [
      {
        tenantId,
        deliveryId,
        eventKind: "taskrun",
        eventPhase: "finished",
        eventTime: timestamp,
        subjectId,
        subjectName,
        subjectURL,
        pipelineRunId,
        repository: repositoryName,
        sha,
        gitRef,
        outcome,
        cdeventJson: buildCDEventJSON({
          source: repositoryURL,
          deliveryId,
          type: "dev.cdevents.taskrun.finished.0.2.0",
          timestamp,
          subjectId,
          content: {
            taskName: subjectName,
            url: subjectURL,
            pipelineRun: {
              id: pipelineRunId,
              source: repositoryURL,
            },
            ...(outcome ? { outcome } : {}),
          },
        }),
      },
    ];
  }

  return [];
}

export function transformToCDEventRows(args: {
  eventType: string;
  deliveryId: string;
  tenantId: number;
  body: Buffer;
}): CDEventRow[] {
  const parsed = parseQueuedWorkflowEvent(args.eventType, args.body);

  if (parsed.eventType === "workflow_run") {
    return transformWorkflowRun(parsed, args.deliveryId, args.tenantId);
  }

  return transformWorkflowJob(parsed, args.deliveryId, args.tenantId);
}

export class ClickHouseCDEventInserter implements CDEventInserter {
  private readonly client;

  constructor(private readonly config = getGitHubEventsConfig()) {
    this.client = createClient({
      url: this.config.cdeventsClickHouseURL,
      username: this.config.cdeventsClickHouseUsername,
      password: this.config.cdeventsClickHousePassword,
      database: this.config.cdeventsClickHouseDatabase,
    });
  }

  async insert(rows: CDEventRow[]) {
    await this.client.insert({
      table: "app.cdevents",
      format: "JSONEachRow",
      values: rows.map((row) => ({
        tenant_id: row.tenantId,
        delivery_id: row.deliveryId,
        event_kind: row.eventKind,
        event_phase: row.eventPhase,
        event_time: formatClickHouseDateTime64(row.eventTime),
        subject_id: row.subjectId,
        subject_name: row.subjectName,
        subject_url: row.subjectURL,
        pipeline_run_id: row.pipelineRunId,
        repository: row.repository,
        sha: row.sha,
        ref: row.gitRef,
        outcome: row.outcome,
        cdevent_json: row.cdeventJson,
      })),
    });
  }
}

export class BufferedCDEventsWriter {
  private pendingWrites: PendingCDEventsWrite[] = [];
  private bufferedRowCount = 0;
  private firstQueuedAt: number | null = null;
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly inserter: CDEventInserter,
    private readonly config = getGitHubEventsConfig(),
  ) {}

  async writeRows(rows: CDEventRow[]) {
    if (rows.length === 0) {
      return;
    }

    if (this.closed) {
      throw new Error("cdevents writer is closed");
    }

    const deferred = createDeferred<void>();
    if (this.pendingWrites.length === 0) {
      this.firstQueuedAt = Date.now();
    }

    this.pendingWrites.push({
      rows,
      resolve: deferred.resolve,
      reject: deferred.reject,
    });
    this.bufferedRowCount += rows.length;
    if (this.bufferedRowCount >= this.config.cdeventsBatchSize) {
      this.triggerFlush();
    } else {
      this.scheduleFlushTimer();
    }

    await deferred.promise;
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearFlushTimer();

    let flushError: unknown;
    if (this.flushPromise) {
      try {
        await this.flushPromise;
      } catch (error) {
        flushError ??= error;
      }
    }

    if (this.pendingWrites.length > 0) {
      try {
        await this.flushPending();
      } catch (error) {
        flushError ??= error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  private triggerFlush() {
    this.clearFlushTimer();
    if (!this.flushPromise) {
      void this.flushPending().catch(() => undefined);
    }
  }

  private scheduleFlushTimer() {
    if (this.flushPromise || this.pendingWrites.length === 0 || this.closed) {
      return;
    }

    const firstQueuedAt = this.firstQueuedAt ?? Date.now();
    const delay = Math.max(
      0,
      firstQueuedAt + this.config.cdeventsFlushIntervalMs - Date.now(),
    );

    this.clearFlushTimer();
    const timer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      this.triggerFlush();
    }, delay);

    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }

    this.flushTimer = timer;
  }

  private async flushPending() {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    if (this.pendingWrites.length === 0) {
      return;
    }

    this.clearFlushTimer();

    const batch = this.pendingWrites;
    this.pendingWrites = [];
    this.bufferedRowCount = 0;
    this.firstQueuedAt = null;

    const rows: CDEventRow[] = [];
    for (const entry of batch) {
      rows.push(...entry.rows);
    }

    this.flushPromise = this.inserter
      .insert(rows)
      .then(() => {
        for (const entry of batch) {
          entry.resolve();
        }
      })
      .catch((error) => {
        for (const entry of batch) {
          entry.reject(error);
        }
        throw error;
      })
      .finally(() => {
        this.flushPromise = null;

        if (this.pendingWrites.length === 0) {
          return;
        }

        if (
          this.closed ||
          this.bufferedRowCount >= this.config.cdeventsBatchSize
        ) {
          this.triggerFlush();
          return;
        }

        this.scheduleFlushTimer();
      });

    return this.flushPromise;
  }

  private clearFlushTimer() {
    if (!this.flushTimer) {
      return;
    }

    globalThis.clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
}

function parseTenantId(rawTenantId: string | null): number {
  const tenantId = rawTenantId ? Number.parseInt(rawTenantId, 10) : 0;
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new TerminalEventError("invalid x-everr-tenant-id");
  }

  return tenantId;
}

let cdeventsWriter: BufferedCDEventsWriter | undefined;

export function getCDEventsWriter(): BufferedCDEventsWriter {
  if (!cdeventsWriter || cdeventsWriter.isClosed()) {
    cdeventsWriter = new BufferedCDEventsWriter(
      new ClickHouseCDEventInserter(),
    );
  }

  return cdeventsWriter;
}

export async function handleCDEventsRequest(
  request: Request,
  writer = getCDEventsWriter(),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const eventType = request.headers.get(headerGitHubEvent)?.trim() ?? "";
  if (!eventType) {
    return new Response("missing x-github-event", { status: 400 });
  }

  const deliveryId = request.headers.get(headerGitHubDelivery)?.trim() ?? "";
  if (!deliveryId) {
    return new Response("missing x-github-delivery", { status: 400 });
  }

  let tenantId: number;
  try {
    tenantId = parseTenantId(request.headers.get(headerTenantId));
  } catch (error) {
    return new Response((error as Error).message, { status: 400 });
  }

  const body = Buffer.from(await request.arrayBuffer());

  let rows: CDEventRow[];
  try {
    rows = transformToCDEventRows({
      eventType,
      deliveryId,
      tenantId,
      body,
    });
  } catch (error) {
    const status = error instanceof TerminalEventError ? 400 : 500;
    return new Response("transform webhook payload", { status });
  }

  if (rows.length === 0) {
    return new Response(null, { status: 202 });
  }

  try {
    await writer.writeRows(rows);
  } catch {
    return new Response("write cdevents rows", { status: 500 });
  }

  return new Response(null, { status: 202 });
}
