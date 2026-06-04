// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookJobData } from "./types";

type MockSpan = {
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

const runtimeMocks = vi.hoisted(() => {
  const span: MockSpan = {
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  };
  const logActiveSpan: boolean[] = [];
  let activeSpan = false;

  type WorkHandler = (jobs: unknown[]) => Promise<void>;

  const workHandlers = new Map<string, WorkHandler>();
  const pgBossInstances: Array<{ send: ReturnType<typeof vi.fn> }> = [];

  return {
    handleStatusEvent: vi.fn(),
    logActiveSpan,
    pgBossInstances,
    replayWebhookToCollector: vi.fn(),
    resolveOrganizationId: vi.fn(),
    serverLoggerError: vi.fn(() => {
      logActiveSpan.push(activeSpan);
    }),
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
    workHandlers,
    PgBoss: vi.fn(function PgBoss() {
      const instance = {
        createQueue: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        work: vi.fn(
          (queue: string, _options: unknown, handler: WorkHandler) => {
            workHandlers.set(queue, handler);
          },
        ),
      };
      pgBossInstances.push(instance);
      return instance;
    }),
  };
});

vi.mock("pg-boss", () => ({
  PgBoss: runtimeMocks.PgBoss,
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: { query: vi.fn() },
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
    info: vi.fn(),
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
  runtimeMocks.PgBoss.mockClear();
  runtimeMocks.handleStatusEvent.mockReset().mockResolvedValue(undefined);
  runtimeMocks.logActiveSpan.length = 0;
  runtimeMocks.pgBossInstances.length = 0;
  runtimeMocks.replayWebhookToCollector
    .mockReset()
    .mockResolvedValue(undefined);
  runtimeMocks.resolveOrganizationId.mockReset().mockResolvedValue("org-1");
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.span.end.mockClear();
  runtimeMocks.span.recordException.mockClear();
  runtimeMocks.span.setStatus.mockClear();
  runtimeMocks.startActiveSpan.mockClear();
  runtimeMocks.workHandlers.clear();

  const runtime = await import("./runtime");
  const types = await import("./types");
  return { runtime, TerminalEventError: types.TerminalEventError };
}

async function startRuntime(data: WebhookJobData) {
  const { runtime, TerminalEventError } = await loadRuntime();
  await runtime.enqueueWebhookEvent("delivery-1", data);
  return { TerminalEventError };
}

async function runWorker(queue: string, data: WebhookJobData) {
  const handler = runtimeMocks.workHandlers.get(queue);
  if (!handler) {
    throw new Error(`missing ${queue} worker`);
  }
  await handler([{ id: `${queue}-job`, data }]);
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("github events runtime", () => {
  it("records collector terminal errors on the replay span", async () => {
    const data = workflowRunData();
    const { TerminalEventError } = await startRuntime(data);
    const error = new TerminalEventError("collector rejected event");
    runtimeMocks.replayWebhookToCollector.mockRejectedValue(error);

    await runWorker("gh-collector", data);

    expect(runtimeMocks.startActiveSpan).toHaveBeenCalledWith(
      "replay github webhook to collector",
      {
        attributes: {
          "github.event.type": "workflow_run",
          "pg_boss.job.id": "gh-collector-job",
        },
        kind: 0,
      },
      expect.any(Function),
    );
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
        "pg_boss.job.id": "gh-collector-job",
      }),
    );
    expect(runtimeMocks.logActiveSpan).toEqual([true]);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });

  it("records status terminal errors on the status span", async () => {
    const data = workflowJobData();
    const { TerminalEventError } = await startRuntime(data);
    const error = new TerminalEventError("workflow job missing data");
    runtimeMocks.handleStatusEvent.mockRejectedValue(error);

    await runWorker("gh-status", data);

    expect(runtimeMocks.startActiveSpan).toHaveBeenCalledWith(
      "handle github status event",
      {
        attributes: {
          "github.event.type": "workflow_job",
          "pg_boss.job.id": "gh-status-job",
        },
        kind: 0,
      },
      expect.any(Function),
    );
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
        "pg_boss.job.id": "gh-status-job",
      }),
    );
    expect(runtimeMocks.logActiveSpan).toEqual([true]);
    expect(runtimeMocks.span.end).toHaveBeenCalledOnce();
  });
});
