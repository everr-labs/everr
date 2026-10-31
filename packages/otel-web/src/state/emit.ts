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
let emitNow: EmitNow | undefined;
let started = false;

export function currentEmit(): Emit | undefined {
  if (!emit && !started) console.warn("[everr] SDK not initialized");
  return emit;
}

export function bindEmit(next: Emit, nextNow?: EmitNow): () => void {
  started = true;
  emit = next;
  emitNow = nextNow;
  return () => {
    // Only the current binding disconnects. A stale disposer, for example from
    // a client that a new client replaced, must not silence the new one.
    if (emit === next) emit = emitNow = undefined;
  };
}

/** @internal For `@everr/otel-web/recording`. Silent when no client is bound. */
export const emitLogNow = (...args: Parameters<EmitNow>): void => void emitNow?.(...args);
