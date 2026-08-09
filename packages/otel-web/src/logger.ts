// The custom log surface: console-style level methods emitted through the
// SDK pipeline, so user logs carry the analytics envelope and join the
// session's other signals (same queue, batching, and exit flush). A custom
// log is a plain OTLP record: no event name, the message as body, the level
// mapped to its OTel severity number. The current pipeline is sampled per
// call from the shared binding, so this module holds no state of its own.

import { currentEmit } from "./current.js";
import type { AttrValue } from "./emitter.js";

const level =
  (severityNumber: number) =>
  (body: string, attributes?: Record<string, AttrValue | null | undefined>) =>
    currentEmit()?.("", attributes, severityNumber, body);

/** Emits a custom log through the SDK pipeline (enveloped, batched). */
export const logger = {
  debug: level(5),
  info: level(9),
  warn: level(13),
  error: level(17),
};
