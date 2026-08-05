// The custom log surface: console-style level methods emitted through the
// SDK pipeline, so user logs carry the analytics envelope and join the
// session's other signals (same queue, batching, and exit flush). A custom
// log is a plain OTLP record: no event name, the message as body, the level
// mapped to its OTel severity number.

import type { AttrValue, Emit } from "./emitter.js";

type LogAttrs = Record<string, AttrValue | null | undefined>;

type Log = (
  severityNumber: number,
  body: string,
  attributes?: LogAttrs,
) => void;

// Before init this warns (never throws) so miswiring is visible; after
// shutdown it is silent by design.
let log: Log = () => console.warn("[everr] SDK not initialized");

const level =
  (severityNumber: number) =>
  (body: string, attributes?: LogAttrs): void =>
    log(severityNumber, body, attributes);

/** Emits a custom log through the SDK pipeline (enveloped, batched). */
export const logger = {
  debug: level(5),
  info: level(9),
  warn: level(13),
  error: level(17),
};

export function startLogger(emit: Emit): () => void {
  log = (severityNumber, body, attributes) =>
    emit("", attributes, severityNumber, body);
  return () => {
    log = () => {};
  };
}
