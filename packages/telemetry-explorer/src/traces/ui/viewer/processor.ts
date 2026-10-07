import type { Span } from "../../data/types";
import {
  executeTraceTask,
  type TraceResponse,
  type TraceResult,
  type TraceTask,
} from "./processor-tasks";
import type { FlamegraphSpan } from "./rendering/types";

// Each operation owns its worker, so cancelling a stale trace terminates its
// computation without delaying another trace. Query caching avoids repeat jobs.
function run(task: TraceTask, signal?: AbortSignal): Promise<TraceResult> {
  signal?.throwIfAborted();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./processor.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // Server rendering and environments without workers use the same algorithm.
    return Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return executeTraceTask(task);
    });
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result?: TraceResult, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (result) resolve(result);
      else reject(error);
    };
    const abort = () => finish(undefined, signal?.reason);
    const timeout = setTimeout(
      () => finish(undefined, new Error("Trace processing took too long.")),
      30_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<TraceResponse>) => {
      const response = event.data;
      if (response.type === "error") {
        finish(undefined, new Error(response.message));
      } else if (response.type !== task.type) {
        finish(undefined, new Error("Unexpected trace processing result."));
      } else {
        finish(response);
      }
    };
    worker.onerror = () =>
      finish(undefined, new Error("Could not prepare this trace."));
    worker.onmessageerror = () =>
      finish(undefined, new Error("Could not read the prepared trace."));
    try {
      worker.postMessage(task);
    } catch (error) {
      finish(undefined, error);
    }
  });
}

export async function prepareTraceModel(spans: Span[], signal?: AbortSignal) {
  const result = await run({ type: "model", spans }, signal);
  if (result.type !== "model") throw new Error("Expected a trace model.");
  return result.model;
}

export async function prepareTraceLayout(
  spans: FlamegraphSpan[],
  signal?: AbortSignal,
) {
  const result = await run({ type: "layout", spans }, signal);
  if (result.type !== "layout") throw new Error("Expected a trace layout.");
  return result.layout;
}
