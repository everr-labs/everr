// The current connection to the pipeline. The package functions logger and
// captureError read this at each call. Thus each of them needs no code to
// change the connection. The WebSDK constructor connects in one place, and
// shutdown() disconnects in that same place.
//
// Before the first connection, an emit gives a warning. Thus an incorrect setup
// is visible. After the code disconnects, an emit gives no warning. This is
// correct.

import type { Emit } from "../pipeline/emitter.js";

let emit: Emit | undefined;
let started = false;

export function currentEmit(): Emit | undefined {
  if (!emit && !started) console.warn("[everr] SDK not initialized");
  return emit;
}

export function bindEmit(next: Emit): () => void {
  started = true;
  emit = next;
  return () => {
    // Only the current binding disconnects. A stale disposer, for example from
    // a client that a new client replaced, must not silence the new one.
    if (emit === next) emit = undefined;
  };
}

// A recording Segment is one request. It does not use the shared logs queue,
// so it has its own binding. No warning before the first connection: calling
// recorder.emitClip() or recorder.startClip() with no WebSDK does nothing.
let emitNow: Emit | undefined;

export function bindEmitNow(next: Emit): () => void {
  emitNow = next;
  return () => {
    if (emitNow === next) emitNow = undefined;
  };
}

export function emitLogNow(
  eventName: Parameters<Emit>[0],
  attributes?: Parameters<Emit>[1],
  timestamp?: Parameters<Emit>[2],
  severityNumber?: Parameters<Emit>[3],
  body?: Parameters<Emit>[4],
): void {
  emitNow?.(eventName, attributes, timestamp, severityNumber, body);
}
