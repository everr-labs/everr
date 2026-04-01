vi.mock("@/db/notify", () => ({
  notifyWorkflowUpdate: vi.fn().mockResolvedValue(undefined),
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWorkflowUpdate } from "@/db/notify";
import { workflowJobs, workflowRuns } from "@/db/schema";
import type { ParsedQueuedWorkflowEvent } from "./payloads";
import {
  handleStatusEvent,
  upsertWorkflowJob,
  upsertWorkflowRun,
} from "./status-writer";
import { generateWorkflowTraceId } from "./trace-id";

const mockedNotify = vi.mocked(notifyWorkflowUpdate);

function createMockDb() {
  const returning = vi.fn().mockResolvedValue([{ traceId: "t1" }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    db: { insert } as unknown as NodePgDatabase,
    insert,
    values,
    onConflictDoUpdate,
    returning,
  };
}

function buildRunEvent(
  action: string,
  overrides: Record<string, unknown> = {},
): Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_run" }> {
  return {
    eventType: "workflow_run",
    payload: {
      action,
      installation: { id: 123 },
      workflow_run: {
        id: 456,
        run_attempt: 1,
        name: "Tests",
        html_url: "https://github.com/acme/repo/actions/runs/456",
        head_branch: "main",
        head_sha: "abc123",
        conclusion: null,
        created_at: "2026-03-05T10:00:00Z",
        updated_at: "2026-03-05T10:01:00Z",
        run_started_at: "2026-03-05T10:00:05Z",
        head_commit: { author: { email: "dev@example.com" } },
        ...overrides,
      },
      repository: {
        id: 654321,
        full_name: "acme/repo",
        html_url: "https://github.com/acme/repo",
      },
    },
  };
}

function buildJobEvent(
  action: string,
  overrides: Record<string, unknown> = {},
): Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_job" }> {
  return {
    eventType: "workflow_job",
    payload: {
      action,
      installation: { id: 123 },
      workflow_job: {
        id: 789,
        run_id: 456,
        run_attempt: 1,
        name: "test",
        html_url: "https://github.com/acme/repo/actions/runs/456/job/789",
        head_branch: "main",
        head_sha: "abc123",
        conclusion: null,
        created_at: "2026-03-05T10:00:00Z",
        started_at: "2026-03-05T10:00:10Z",
        completed_at: null,
        workflow_name: "Tests",
        runner_name: null,
        runner_labels: null,
        runner_group_name: null,
        ...overrides,
      },
      repository: {
        id: 654321,
        full_name: "acme/repo",
        html_url: "https://github.com/acme/repo",
      },
    },
  };
}

const opTimestamp = new Date("2026-03-06T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(opTimestamp);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upsertWorkflowRun", () => {
  it("preserves requested workflow run status", async () => {
    const { db, insert, values, onConflictDoUpdate } = createMockDb();

    await upsertWorkflowRun(db, 42, buildRunEvent("requested"));

    expect(insert).toHaveBeenCalledWith(workflowRuns);
    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      tenantId: 42,
      runId: 456,
      attempts: 1,
      traceId: generateWorkflowTraceId(654321, 456, 1),
      workflowName: "Tests",
      repository: "acme/repo",
      sha: "abc123",
      ref: "main",
      status: "requested",
      conclusion: null,
      authorEmail: "dev@example.com",
      startedAt: new Date("2026-03-05T10:00:05Z"),
      completedAt: null,
      lastEventAt: new Date("2026-03-05T10:01:00Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
    expect(insertedValues.metadata).toMatchObject({
      html_url: "https://github.com/acme/repo/actions/runs/456",
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
      }),
    );
    expect(mockedNotify).toHaveBeenCalledOnce();
    expect(mockedNotify).toHaveBeenCalledWith(db, {
      tenantId: 42,
      traceId: generateWorkflowTraceId(654321, 456, 1),
      runId: "456",
      sha: "abc123",
      authorEmail: "dev@example.com",
    });
  });

  it("preserves waiting workflow run status", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowRun(db, 42, buildRunEvent("waiting"));

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "waiting",
      lastEventAt: new Date("2026-03-05T10:01:00Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("uses the freshest event timestamp for in_progress workflow runs", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowRun(db, 42, buildRunEvent("in_progress"));

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "in_progress",
      lastEventAt: new Date("2026-03-05T10:01:00Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("records completedAt for completed workflow runs", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowRun(
      db,
      42,
      buildRunEvent("completed", { conclusion: "success" }),
    );

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "completed",
      conclusion: "success",
      completedAt: new Date("2026-03-05T10:01:00Z"),
      lastEventAt: new Date("2026-03-05T10:01:00Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("populates metadata from the workflow_run payload", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowRun(
      db,
      42,
      buildRunEvent("requested", {
        event: "push",
        workflow_id: 100,
        display_title: "Run Tests",
        run_number: 7,
        path: ".github/workflows/ci.yml",
        actor: { login: "octocat" },
        triggering_actor: { login: "mergify" },
        pull_requests: [{ number: 42 }, { number: 99 }],
        head_repository: { full_name: "acme/repo" },
      }),
    );

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues.metadata).toEqual({
      event: "push",
      workflow_id: 100,
      display_title: "Run Tests",
      run_number: 7,
      path: ".github/workflows/ci.yml",
      actor: "octocat",
      triggering_actor: "mergify",
      pull_requests: [42, 99],
      head_repository: "acme/repo",
      html_url: "https://github.com/acme/repo/actions/runs/456",
    });
  });

  it("does not notify when upsert returns no rows (stale event)", async () => {
    const { db, returning } = createMockDb();
    returning.mockResolvedValue([]);

    await upsertWorkflowRun(db, 42, buildRunEvent("requested"));

    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("throws on missing workflow_run", async () => {
    const { db } = createMockDb();
    const event = buildRunEvent("requested");
    event.payload.workflow_run = undefined;

    await expect(upsertWorkflowRun(db, 42, event)).rejects.toThrow(
      "workflow_run payload missing workflow_run",
    );
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("throws when repository.id is missing from workflow runs", async () => {
    const { db } = createMockDb();
    const event = buildRunEvent("requested");
    delete event.payload.repository?.id;

    await expect(upsertWorkflowRun(db, 42, event)).rejects.toThrow(
      "workflow event missing repository.id",
    );
    expect(mockedNotify).not.toHaveBeenCalled();
  });
});

describe("upsertWorkflowJob", () => {
  it("inserts a queued workflow job with canonical storage fields", async () => {
    const { db, insert, values, onConflictDoUpdate } = createMockDb();

    await upsertWorkflowJob(db, 42, buildJobEvent("queued"));

    expect(insert).toHaveBeenCalledWith(workflowJobs);
    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      tenantId: 42,
      jobId: 789,
      runId: 456,
      attempts: 1,
      traceId: generateWorkflowTraceId(654321, 456, 1),
      jobName: "test",
      repository: "acme/repo",
      status: "queued",
      lastEventAt: new Date("2026-03-05T10:00:10Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
    expect(insertedValues.metadata).toMatchObject({
      html_url: "https://github.com/acme/repo/actions/runs/456/job/789",
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
      }),
    );
    expect(mockedNotify).toHaveBeenCalledOnce();
    expect(mockedNotify).toHaveBeenCalledWith(db, {
      tenantId: 42,
      traceId: generateWorkflowTraceId(654321, 456, 1),
      runId: "456",
      sha: "abc123",
      authorEmail: null,
    });
  });

  it("preserves requested workflow job status", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowJob(db, 42, buildJobEvent("requested"));

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "requested",
      lastEventAt: new Date("2026-03-05T10:00:10Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("preserves waiting workflow job status", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowJob(db, 42, buildJobEvent("waiting"));

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "waiting",
      lastEventAt: new Date("2026-03-05T10:00:10Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("uses started_at as the ordering timestamp for in_progress workflow jobs", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowJob(db, 42, buildJobEvent("in_progress"));

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "in_progress",
      startedAt: new Date("2026-03-05T10:00:10Z"),
      lastEventAt: new Date("2026-03-05T10:00:10Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("inserts a completed workflow job with conclusion", async () => {
    const { db, values } = createMockDb();

    await upsertWorkflowJob(
      db,
      42,
      buildJobEvent("completed", {
        conclusion: "failure",
        completed_at: "2026-03-05T10:05:00Z",
      }),
    );

    const insertedValues = values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({
      status: "completed",
      conclusion: "failure",
      completedAt: new Date("2026-03-05T10:05:00Z"),
      lastEventAt: new Date("2026-03-05T10:05:00Z"),
      createdAt: opTimestamp,
      updatedAt: opTimestamp,
    });
  });

  it("does not notify when upsert returns no rows (stale event)", async () => {
    const { db, returning } = createMockDb();
    returning.mockResolvedValue([]);

    await upsertWorkflowJob(db, 42, buildJobEvent("queued"));

    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("throws on missing workflow_job", async () => {
    const { db } = createMockDb();
    const event = buildJobEvent("in_progress");
    event.payload.workflow_job = undefined;

    await expect(upsertWorkflowJob(db, 42, event)).rejects.toThrow(
      "workflow_job payload missing workflow_job",
    );
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("throws when repository.id is missing from workflow jobs", async () => {
    const { db } = createMockDb();
    const event = buildJobEvent("queued");
    delete event.payload.repository?.id;

    await expect(upsertWorkflowJob(db, 42, event)).rejects.toThrow(
      "workflow event missing repository.id",
    );
    expect(mockedNotify).not.toHaveBeenCalled();
  });
});

describe("handleStatusEvent", () => {
  it("routes workflow_run events to upsertWorkflowRun", async () => {
    const { db, insert } = createMockDb();

    await handleStatusEvent(db, 42, buildRunEvent("requested"));

    expect(insert).toHaveBeenCalledWith(workflowRuns);
  });

  it("routes workflow_job events to upsertWorkflowJob", async () => {
    const { db, insert } = createMockDb();

    await handleStatusEvent(db, 42, buildJobEvent("in_progress"));

    expect(insert).toHaveBeenCalledWith(workflowJobs);
  });
});
