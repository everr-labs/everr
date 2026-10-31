// The current connection to the pipeline. The package functions logger and
// captureError read this at each call. Thus each of them needs no code to
// change the connection. The WebSDK constructor connects in one place, and
// shutdown() disconnects in that same place.
//
// Before the first connection, an emit gives a warning. Thus an incorrect setup
// is visible. After the code disconnects, an emit gives no warning. This is
// correct.

import type { Emit, EmitNow } from "../pipeline/emitter.js";

let emit: Emit | undefined;
let flush: (() => unknown) | undefined;
let emitNow: EmitNow | undefined;
let started = false;

/** Sends the records that wait in the batch queue of the current pipeline. */
export const flushCurrent = (): unknown => flush?.();

export function currentEmit(): Emit | undefined {
  if (!emit && !started) console.warn("[everr] SDK not initialized");
  return emit;
}

export function bindEmit(next: Emit, nextFlush?: () => unknown, nextNow?: EmitNow): () => void {
  started = true;
  emit = next;
  flush = nextFlush;
  emitNow = nextNow;
  return () => {
    // Only the current binding disconnects. A stale disposer, for example from
    // a client that a new client replaced, must not silence the new one.
    if (emit === next) emit = flush = emitNow = undefined;
  };
}

/** @internal For `@everr/otel-web/recording`. Silent when no client is bound. */
export const emitLogNow = (...args: Parameters<EmitNow>): void => void emitNow?.(...args);
