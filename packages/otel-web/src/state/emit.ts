// The current connection to the pipeline. The package functions logger and
// captureError read this at each call. Thus each of them needs no code to
// change the connection. The WebSDK constructor connects in one place, and
// shutdown() disconnects in that same place.
//
// Before the first connection, an emit gives a warning. Thus an incorrect setup
// is visible. After the code disconnects, an emit gives no warning. This is
// correct.
//
// A production build removes the warning and the flag that carries it. The
// warning helps the developer who forgets the setup, and that developer runs a
// development build.

import type { Emit } from "../pipeline/emitter.js";

let emit: Emit | undefined;
let started = false;

export function currentEmit(): Emit | undefined {
  if (process.env.NODE_ENV !== "production" && !emit && !started)
    console.warn("[everr] SDK not initialized");
  return emit;
}

export function bindEmit(next: Emit): () => void {
  if (process.env.NODE_ENV !== "production") started = true;
  emit = next;
  return () => {
    emit = undefined;
  };
}
