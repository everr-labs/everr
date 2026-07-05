// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { WebhookJobData } from "./types";

const COLLECTOR_TASK_IDENTIFIER = "github-events/collector";
const STATUS_TASK_IDENTIFIER = "github-events/status";

type MockSpan = {
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

const taskMocks = vi.hoisted(() => {
  const span: MockSpan = {
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
  };
  const logActiveSpan: boolean[] = [];
  let activeSpan = false;

  return {
    handleStatusEvent: vi.fn(),
    logActiveSpan,
    replayWebhookToCollector: vi.fn(),
    resolveOrganizationId: vi.fn(),
    serverLoggerError: vi.fn(() => {
      logActiveSpan.push(activeSpan);
    }),
    serverLoggerInfo: vi.fn(() => {
      logActiveSpan.push(activeSpan);
    }),
    span,
    startActiveSpan: vi.fn(
      async (_name: string, _options: unknown, run: (span: MockSpan) => Promise<unknown>) => {
        activeSpan = true;
        try {
          return await run(span);
        } finally {
          activeSpan = false;
        }
      },
    ),
  };
});

vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  errorMessage: (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
  serverLogger: {
    error: taskMocks.serverLoggerError,
    info: taskMocks.serverLoggerInfo,
  },
}));

vi.mock("@/telemetry/node", () => ({
  getTelemetryTracer: () => ({
    startActiveSpan: taskMocks.startActiveSpan,
  }),
}));

vi.mock("./collector", () => ({
  replayWebhookToCollector: taskMocks.replayWebhookToCollector,
}));

vi.mock("./status-writer", () => ({
  handleStatusEvent: taskMocks.handleStatusEvent,
}));

vi.mock("./tenant-resolver", () => ({
  resolveOrganizationId: taskMocks.resolveOrganizationId,
}));

import { githubEventsTaskList } from "./tasks";
import { StaleInstallationError, TerminalEventError } from "./types";

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function workflowRunData(): WebhookJobData {
  return {
    body: encodePayload({
      action: "completed",
      installation: { id: 123 },
      repository: { id: 456, full_name: "acme/widgets" },
      workflow_run: { id: 789, run_attempt: 1, name: "Build & Test" },
    }),
    headers: { "x-github-event": ["workflow_run"] },
  };
}

function workflowJobData(): WebhookJobData {
  return {
    body: encodePayload({
      action: "completed",
      installation: { id: 123 },
      repository: { id: 456, full_name: "acme/widgets" },
      workflow_job: { id: 789, run_id: 654, run_attempt: 1 },
    }),
    headers: { "x-github-event": ["workflow_job"] },
  };
}

async function runTask(
  taskIdentifier: string,
  data: WebhookJobData,
  jobId = `${taskIdentifier}-job`,
) {
  const task = githubEventsTaskList[taskIdentifier];
  if (!task) {
    throw new Error(`missing ${taskIdentifier} task`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: helpers are mocked minimally
  await task(data, { job: { id: jobId } } as any);
}

beforeEach(() => {
  taskMocks.handleStatusEvent.mockReset().mockResolvedValue(undefined);
  taskMocks.logActiveSpan.length = 0;
  taskMocks.replayWebhookToCollector.mockReset().mockResolvedValue(undefined);
  taskMocks.resolveOrganizationId.mockReset().mockResolvedValue("org-1");
  taskMocks.serverLoggerError.mockClear();
  taskMocks.serverLoggerInfo.mockClear();
  taskMocks.span.end.mockClear();
  taskMocks.span.recordException.mockClear();
  taskMocks.span.setAttribute.mockClear();
  taskMocks.span.setStatus.mockClear();
  taskMocks.startActiveSpan.mockClear();
});

describe("github events tasks", () => {
  it("collector tasks replay the webhook payload to the collector", async () => {
    const data = workflowRunData();

    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1");

    expect(taskMocks.resolveOrganizationId).toHaveBeenCalledWith(123);
    expect(taskMocks.replayWebhookToCollector).toHaveBeenCalledOnce();
    expect(taskMocks.replayWebhookToCollector).toHaveBeenCalledWith(
      {
        body: Buffer.from(data.body, "base64"),
        headers: data.headers,
      },
      "org-1",
    );
    expect(taskMocks.startActiveSpan).toHaveBeenCalledWith(
      "github_events.jobs.replay_webhook_to_collector",
      {
        attributes: {
          "github.event.action": "completed",
          "github.event.type": "workflow_run",
          "github.repository.full_name": "acme/widgets",
          "github.workflow_run.id": 789,
          "github.workflow_run.name": "Build & Test",
          "github.workflow_run.run_attempt": 1,
          "graphile_worker.job.id": "collector-job-1",
        },
        kind: 0,
      },
      expect.any(Function),
    );
    expect(taskMocks.span.setAttribute).toHaveBeenCalledWith("everr.organization.id", "org-1");
  });

  it("status tasks pass the parsed workflow event to the status writer", async () => {
    const data = workflowJobData();

    await runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1");

    expect(taskMocks.resolveOrganizationId).toHaveBeenCalledWith(123);
    expect(taskMocks.handleStatusEvent).toHaveBeenCalledOnce();
    expect(taskMocks.handleStatusEvent).toHaveBeenCalledWith(
      {},
      "org-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          repository: { id: 456, full_name: "acme/widgets" },
          workflow_job: { id: 789, run_id: 654, run_attempt: 1 },
        }),
        eventType: "workflow_job",
      }),
    );
    expect(taskMocks.startActiveSpan).toHaveBeenCalledWith(
      "github_events.jobs.handle_status_event",
      {
        attributes: {
          "github.event.action": "completed",
          "github.event.type": "workflow_job",
          "github.repository.full_name": "acme/widgets",
          "github.workflow_job.id": 789,
          "github.workflow_run.id": 654,
          "github.workflow_run.run_attempt": 1,
          "graphile_worker.job.id": "status-job-1",
        },
        kind: 0,
      },
      expect.any(Function),
    );
  });

  it("records collector terminal errors on the replay span without throwing", async () => {
    const data = workflowRunData();
    const error = new TerminalEventError("collector rejected event");
    taskMocks.replayWebhookToCollector.mockRejectedValue(error);

    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1");

    expect(taskMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(taskMocks.span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TerminalEventError: collector rejected event",
    });
    expect(taskMocks.serverLoggerError).toHaveBeenCalledWith(
      "github_events.jobs.collector_terminal_error",
      expect.objectContaining({
        "exception.message": "collector rejected event",
        "exception.type": "TerminalEventError",
        "github.event.type": "workflow_run",
        "graphile_worker.job.id": "collector-job-1",
      }),
    );
    expect(taskMocks.logActiveSpan).toEqual([true]);
    expect(taskMocks.span.end).toHaveBeenCalledOnce();
  });

  it("drops stale installation terminal events without error telemetry", async () => {
    const data = workflowRunData();
    const error = new StaleInstallationError("organization not found for installation");
    taskMocks.resolveOrganizationId.mockRejectedValue(error);

    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1");
    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-2");

    expect(taskMocks.span.recordException).not.toHaveBeenCalled();
    expect(taskMocks.span.setStatus).not.toHaveBeenCalled();
    expect(taskMocks.serverLoggerError).not.toHaveBeenCalled();
    expect(taskMocks.serverLoggerInfo).toHaveBeenCalledOnce();
    expect(taskMocks.serverLoggerInfo).toHaveBeenCalledWith(
      "github_events.jobs.stale_installation_dropped",
      expect.objectContaining({
        "error.message": "organization not found for installation",
        "error.type": "StaleInstallationError",
        "github.event.type": "workflow_run",
        "github.installation.id": 123,
        "graphile_worker.job.id": "collector-job-1",
      }),
    );
    expect(taskMocks.logActiveSpan).toEqual([true]);
    expect(taskMocks.span.end).toHaveBeenCalledTimes(2);
  });

  it("records status terminal errors on the status span without throwing", async () => {
    const data = workflowJobData();
    const error = new TerminalEventError("workflow job missing data");
    taskMocks.handleStatusEvent.mockRejectedValue(error);

    await runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1");

    expect(taskMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(taskMocks.span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TerminalEventError: workflow job missing data",
    });
    expect(taskMocks.serverLoggerError).toHaveBeenCalledWith(
      "github_events.jobs.handle_status_terminal_error",
      expect.objectContaining({
        "exception.message": "workflow job missing data",
        "exception.type": "TerminalEventError",
        "github.event.type": "workflow_job",
        "graphile_worker.job.id": "status-job-1",
      }),
    );
    expect(taskMocks.logActiveSpan).toEqual([true]);
    expect(taskMocks.span.end).toHaveBeenCalledOnce();
  });

  it("throws retryable collector errors so Graphile Worker retries the job", async () => {
    const data = workflowRunData();
    const error = new Error("collector unavailable");
    taskMocks.replayWebhookToCollector.mockRejectedValue(error);

    await expect(runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1")).rejects.toThrow(
      "collector unavailable",
    );

    expect(taskMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(taskMocks.span.end).toHaveBeenCalledOnce();
  });

  it("throws retryable status errors so Graphile Worker retries the job", async () => {
    const data = workflowJobData();
    const error = new Error("status database unavailable");
    taskMocks.handleStatusEvent.mockRejectedValue(error);

    await expect(runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1")).rejects.toThrow(
      "status database unavailable",
    );

    expect(taskMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(taskMocks.span.end).toHaveBeenCalledOnce();
  });
});
