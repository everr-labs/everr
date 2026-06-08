// @vitest-environment node
import type { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookJobData } from "./types";

const COLLECTOR_TASK_IDENTIFIER = "github-events/collector";
const STATUS_TASK_IDENTIFIER = "github-events/status";

type MockSpan = {
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

type MockTaskHelpers = {
  job: {
    id: string;
  };
};

type MockTask = (
  payload: WebhookJobData,
  helpers: MockTaskHelpers,
) => Promise<void>;

type MockRunner = {
  addJob: ReturnType<typeof vi.fn>;
  events: EventEmitter;
  promise: Promise<void>;
  stop: ReturnType<typeof vi.fn>;
};

type MockRunOptions = {
  concurrency: number;
  events: EventEmitter;
  noHandleSignals: boolean;
  pgPool: unknown;
  taskList: Record<string, MockTask>;
};

const runtimeMocks = vi.hoisted(() => {
  const span: MockSpan = {
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  };
  const logActiveSpan: boolean[] = [];
  let activeSpan = false;

  const runOptions: MockRunOptions[] = [];
  const runnerInstances: MockRunner[] = [];
  const pool = { query: vi.fn() };

  return {
    handleStatusEvent: vi.fn(),
    logActiveSpan,
    pool,
    replayWebhookToCollector: vi.fn(),
    resolveOrganizationId: vi.fn(),
    run: vi.fn(async (options: MockRunOptions) => {
      runOptions.push(options);
      const runner: MockRunner = {
        addJob: vi.fn().mockResolvedValue(undefined),
        events: options.events,
        promise: Promise.resolve(),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      runnerInstances.push(runner);
      return runner;
    }),
    runOptions,
    runnerInstances,
    serverLoggerError: vi.fn(() => {
      logActiveSpan.push(activeSpan);
    }),
    serverLoggerInfo: vi.fn(),
    span,
    startActiveSpan: vi.fn(
      async (
        _name: string,
        _options: unknown,
        run: (span: MockSpan) => Promise<unknown>,
      ) => {
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

vi.mock("graphile-worker", () => ({
  run: runtimeMocks.run,
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: runtimeMocks.pool,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  serverLogger: {
    error: runtimeMocks.serverLoggerError,
    info: runtimeMocks.serverLoggerInfo,
  },
}));

vi.mock("@/telemetry/node", () => ({
  getTelemetryTracer: () => ({
    startActiveSpan: runtimeMocks.startActiveSpan,
  }),
}));

vi.mock("./collector", () => ({
  replayWebhookToCollector: runtimeMocks.replayWebhookToCollector,
}));

vi.mock("./status-writer", () => ({
  handleStatusEvent: runtimeMocks.handleStatusEvent,
}));

vi.mock("./tenant-resolver", () => ({
  resolveOrganizationId: runtimeMocks.resolveOrganizationId,
}));

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function workflowRunData(): WebhookJobData {
  return {
    body: encodePayload({
      installation: { id: 123 },
      repository: { id: 456 },
      workflow_run: { id: 789, run_attempt: 1 },
    }),
    headers: { "x-github-event": ["workflow_run"] },
  };
}

function workflowJobData(): WebhookJobData {
  return {
    body: encodePayload({
      installation: { id: 123 },
      repository: { id: 456 },
      workflow_job: { id: 789, run_id: 654, run_attempt: 1 },
    }),
    headers: { "x-github-event": ["workflow_job"] },
  };
}

async function loadRuntime() {
  vi.resetModules();
  runtimeMocks.handleStatusEvent.mockReset().mockResolvedValue(undefined);
  runtimeMocks.logActiveSpan.length = 0;
  runtimeMocks.pool.query.mockReset();
  runtimeMocks.replayWebhookToCollector
    .mockReset()
    .mockResolvedValue(undefined);
  runtimeMocks.resolveOrganizationId.mockReset().mockResolvedValue("org-1");
  runtimeMocks.run.mockClear();
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.runnerInstances.length = 0;
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  runtimeMocks.span.end.mockClear();
  runtimeMocks.span.recordException.mockClear();
  runtimeMocks.span.setStatus.mockClear();
  runtimeMocks.startActiveSpan.mockClear();

  const runtime = await import("./runtime");
  const types = await import("./types");
  return { runtime, TerminalEventError: types.TerminalEventError };
}

async function startRuntime(data: WebhookJobData) {
  const { runtime, TerminalEventError } = await loadRuntime();
  await runtime.enqueueWebhookEvent("delivery-1", data);
  return { runtime, TerminalEventError };
}

function taskList(): Record<string, MockTask> {
  const options = runtimeMocks.runOptions[0];
  if (!options) {
    throw new Error("Graphile Worker was not started");
  }
  return options.taskList;
}

async function runTask(
  taskIdentifier: string,
  data: WebhookJobData,
  jobId = `${taskIdentifier}-job`,
) {
  const task = taskList()[taskIdentifier];
  if (!task) {
    throw new Error(`missing ${taskIdentifier} task`);
  }
  await task(data, { job: { id: jobId } });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("github events runtime", () => {
  it("starts the Graphile Worker runner lazily on first enqueue", async () => {
    const { runtime } = await loadRuntime();

    expect(runtimeMocks.run).not.toHaveBeenCalled();

    await runtime.enqueueWebhookEvent("delivery-1", workflowRunData());

    expect(runtimeMocks.serverLoggerInfo).toHaveBeenCalledWith(
      "github_events.runtime.start",
    );
    expect(runtimeMocks.run).toHaveBeenCalledOnce();
    expect(runtimeMocks.runOptions[0]).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.pool,
    });
    expect(Object.keys(runtimeMocks.runOptions[0].taskList).sort()).toEqual([
      COLLECTOR_TASK_IDENTIFIER,
      STATUS_TASK_IDENTIFIER,
    ]);
  });

  it("adds collector and status jobs for the same event", async () => {
    const data = workflowRunData();
    const { runtime } = await loadRuntime();

    await runtime.enqueueWebhookEvent("delivery-1", data);

    const addJob = runtimeMocks.runnerInstances[0].addJob;
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(1, COLLECTOR_TASK_IDENTIFIER, data, {
      jobKey: "github-events/collector:delivery-1",
      maxAttempts: 10,
    });
    expect(addJob).toHaveBeenNthCalledWith(2, STATUS_TASK_IDENTIFIER, data, {
      jobKey: "github-events/status:delivery-1",
      maxAttempts: 10,
    });
    expect(addJob.mock.calls[0][2]).not.toHaveProperty("queueName");
    expect(addJob.mock.calls[0][2]).not.toHaveProperty("jobKeyMode");
    expect(addJob.mock.calls[1][2]).not.toHaveProperty("queueName");
    expect(addJob.mock.calls[1][2]).not.toHaveProperty("jobKeyMode");
  });

  it("reuses the started runner after the first enqueue", async () => {
    const { runtime } = await loadRuntime();

    await runtime.enqueueWebhookEvent("delivery-1", workflowRunData());
    await runtime.enqueueWebhookEvent("delivery-2", workflowJobData());

    expect(runtimeMocks.run).toHaveBeenCalledOnce();
    expect(runtimeMocks.runnerInstances[0].addJob).toHaveBeenCalledTimes(4);
  });

  it("collector tasks replay the webhook payload to the collector", async () => {
    const data = workflowRunData();
    await startRuntime(data);

    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1");

    expect(runtimeMocks.resolveOrganizationId).toHaveBeenCalledWith(123);
    expect(runtimeMocks.replayWebhookToCollector).toHaveBeenCalledOnce();
    expect(runtimeMocks.replayWebhookToCollector).toHaveBeenCalledWith(
      {
        body: Buffer.from(data.body, "base64"),
        headers: data.headers,
      },
      "org-1",
    );
    expect(runtimeMocks.startActiveSpan).toHaveBeenCalledWith(
      "replay github webhook to collector",
      {
        attributes: {
          "github.event.type": "workflow_run",
          "graphile_worker.job.id": "collector-job-1",
        },
        kind: 0,
      },
      expect.any(Function),
    );
  });

  it("status tasks pass the parsed workflow event to the status writer", async () => {
    const data = workflowJobData();
    await startRuntime(data);

    await runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1");

    expect(runtimeMocks.resolveOrganizationId).toHaveBeenCalledWith(123);
    expect(runtimeMocks.handleStatusEvent).toHaveBeenCalledOnce();
    expect(runtimeMocks.handleStatusEvent).toHaveBeenCalledWith(
      {},
      "org-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          repository: { id: 456 },
          workflow_job: { id: 789, run_id: 654, run_attempt: 1 },
        }),
        eventType: "workflow_job",
      }),
    );
    expect(runtimeMocks.startActiveSpan).toHaveBeenCalledWith(
      "handle github status event",
      {
        attributes: {
          "github.event.type": "workflow_job",
          "graphile_worker.job.id": "status-job-1",
        },
        kind: 0,
      },
      expect.any(Function),
    );
  });

  it("records collector terminal errors on the replay span without throwing", async () => {
    const data = workflowRunData();
    const { TerminalEventError } = await startRuntime(data);
    const error = new TerminalEventError("collector rejected event");
    runtimeMocks.replayWebhookToCollector.mockRejectedValue(error);

    await runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1");

    expect(runtimeMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(runtimeMocks.span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TerminalEventError: collector rejected event",
    });
    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "github_events.collector.terminal_error",
      expect.objectContaining({
        "exception.message": "collector rejected event",
        "exception.type": "TerminalEventError",
        "github.event.type": "workflow_run",
        "graphile_worker.job.id": "collector-job-1",
      }),
    );
    expect(runtimeMocks.logActiveSpan).toEqual([true]);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });

  it("records status terminal errors on the status span without throwing", async () => {
    const data = workflowJobData();
    const { TerminalEventError } = await startRuntime(data);
    const error = new TerminalEventError("workflow job missing data");
    runtimeMocks.handleStatusEvent.mockRejectedValue(error);

    await runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1");

    expect(runtimeMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(runtimeMocks.span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TerminalEventError: workflow job missing data",
    });
    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "github_events.status.terminal_error",
      expect.objectContaining({
        "exception.message": "workflow job missing data",
        "exception.type": "TerminalEventError",
        "github.event.type": "workflow_job",
        "graphile_worker.job.id": "status-job-1",
      }),
    );
    expect(runtimeMocks.logActiveSpan).toEqual([true]);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });

  it("throws retryable collector errors so Graphile Worker retries the job", async () => {
    const data = workflowRunData();
    await startRuntime(data);
    const error = new Error("collector unavailable");
    runtimeMocks.replayWebhookToCollector.mockRejectedValue(error);

    await expect(
      runTask(COLLECTOR_TASK_IDENTIFIER, data, "collector-job-1"),
    ).rejects.toThrow("collector unavailable");

    expect(runtimeMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });

  it("throws retryable status errors so Graphile Worker retries the job", async () => {
    const data = workflowJobData();
    await startRuntime(data);
    const error = new Error("status database unavailable");
    runtimeMocks.handleStatusEvent.mockRejectedValue(error);

    await expect(
      runTask(STATUS_TASK_IDENTIFIER, data, "status-job-1"),
    ).rejects.toThrow("status database unavailable");

    expect(runtimeMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });

  it("logs meaningful Graphile Worker runner failures", async () => {
    const { runtime } = await loadRuntime();
    await runtime.enqueueWebhookEvent("delivery-1", workflowRunData());

    const error = new Error("listen failed");
    runtimeMocks.runOptions[0].events.emit("pool:listen:error", {
      client: {},
      error,
      workerPool: {},
    });

    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "github_events.graphile_worker.pool_listen_error",
      expect.objectContaining({
        "exception.message": "listen failed",
        "exception.type": "Error",
      }),
    );
  });
});
