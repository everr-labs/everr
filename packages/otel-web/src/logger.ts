// The functions for the custom logs. They have the levels of the console
// methods, and the SDK pipeline sends them. Thus the logs of the user carry the
// analytics envelope, and they go with the other signals of the session. They
// use the same queue, the same batches, and the same flush at exit.
//
// A custom log is a usual OTLP record: it has no event name, the message is the
// body, and the level becomes the equivalent OTel severity number. The code
// reads the current pipeline from the shared binding at each call. Thus this
// module keeps no data.

import type { AttrValue } from "./pipeline/emitter.js";
import { currentEmit } from "./state/emit.js";

const level =
  (severityNumber: number) =>
  (body: string, attributes?: Record<string, AttrValue | null | undefined>) =>
    currentEmit()?.("", attributes, undefined, severityNumber, body);

/** Sends a custom log on the SDK pipeline. The log carries the envelope, and
 * the SDK puts it in a batch. */
export const logger = {
  debug: level(5),
  info: level(9),
  warn: level(13),
  error: level(17),
};
