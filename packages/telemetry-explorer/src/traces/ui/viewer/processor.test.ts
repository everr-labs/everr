import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Span } from "../../data/types";
import { prepareTraceLayout, prepareTraceModel } from "./processor";
import {
  executeTraceTask,
  type TraceResponse,
  type TraceTask,
} from "./processor-tasks";

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: MessageEvent<TraceResponse>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  task!: TraceTask;
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  postMessage(task: TraceTask) {
    this.task = task;
  }
  respond() {
    this.onmessage?.(
      new MessageEvent("message", { data: executeTraceTask(this.task) }),
    );
  }
}

function span(id: string): Span {
  return {
    traceId: id,
    spanId: id,
    parentSpanId: "",
    spanName: id,
    serviceName: "api",
    serviceNamespace: "",
    timestamp: "2026-10-06 12:00:00.000",
    timestampNs: "1791288000000000000",
    duration: "1000000",
    statusCode: "Ok",
    spanKind: "Internal",
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
  };
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("prepares the model without computing layout, then computes layout on demand", async () => {
  const result = prepareTraceModel([span("root")]);
  expect(workers[0].task.type).toBe("model");
  workers[0].respond();
  const model = await result;
  expect(model.byId.get("root")).toBe(model.waterfall[0]);
  expect(model).not.toHaveProperty("layout");
  expect(model.startNs).toBe(1791288000000000000n);
  expect(workers[0].terminate).toHaveBeenCalledOnce();

  const layout = prepareTraceLayout(model.waterfall);
  workers[1].respond();
  expect((await layout).spanToVisualRow.root).toBe(0);
  expect(workers[1].terminate).toHaveBeenCalledOnce();
});

it("keeps overlapping trace requests independent when results arrive out of order", async () => {
  const first = prepareTraceModel([span("first")]);
  const second = prepareTraceModel([span("second")]);
  workers[1].respond();
  expect((await second).roots[0].spanId).toBe("second");
  workers[0].respond();
  expect((await first).roots[0].spanId).toBe("first");
});

it("terminates cancelled work and ignores a late result while another trace loads", async () => {
  const controller = new AbortController();
  const cancelled = prepareTraceModel([span("old")], controller.signal);
  const rejection = expect(cancelled).rejects.toMatchObject({
    name: "AbortError",
  });
  const current = prepareTraceModel([span("current")]);
  controller.abort();
  await rejection;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  workers[0].respond();
  workers[1].respond();
  expect((await current).roots[0].spanId).toBe("current");
});

it("rejects processing errors and releases the worker", async () => {
  const result = prepareTraceModel([span("root")]);
  const rejection = expect(result).rejects.toThrow("invalid span");
  workers[0].onmessage?.(
    new MessageEvent("message", {
      data: { type: "error", message: "invalid span" },
    }),
  );
  await rejection;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it("terminates an unresponsive worker instead of keeping the view pending", async () => {
  vi.useFakeTimers();
  const result = prepareTraceModel([span("root")]);
  const rejection = expect(result).rejects.toThrow("too long");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejection;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it("uses the same computation when workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  const model = await prepareTraceModel([span("root")]);
  expect(model.roots[0].spanId).toBe("root");
  expect((await prepareTraceLayout(model.waterfall)).totalVisualRows).toBe(1);
});
