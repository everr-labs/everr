// The rules for an instrumentation. The code that operates them is in the
// WebSDK constructor. That constructor calls each instrumentation with a small
// context. The context has seven members and nothing more: no transport, no
// batch code, and no internal parts of a record. The shutdown() function calls
// the stop functions in the opposite sequence, before the pipeline
// disconnects.
//
// A new construction for the consent stops each instrumentation and starts it
// again. Thus each instrumentation gets the new persistence mode, and it needs
// no code for this.
//
// The code uses the array without a change, and it keeps a duplicate. The
// start function and the stop function operate without a try block. If an
// instrumentation throws an error, that is an error of the caller. This code
// does not hide it.

import type { Tracer } from "@opentelemetry/api";
import type { AttrValue } from "../pipeline/emitter.js";
import type { PageContext } from "../state/session.js";

/**
 * The data that the `setup` function of an instrumentation receives. It
 * contains all the data that a source of the capture needs, and nothing more.
 */
export interface InstrumentationContext {
  /**
   * Sends an event record on the standard pipeline. The SDK writes the ambient
   * envelope on the record: the session, the page, the route, the identity, and
   * the context from `setAttributes`. Then it puts the record in the batch with
   * the other records. The SDK ignores an attribute value of null and an
   * attribute value of undefined. Thus an optional attribute needs no
   * additional code. The optional timestamp is integer epoch milliseconds.
   * Normalize a browser timestamp with `epoch()` at the capture site. Without
   * it, the SDK uses the instant that `emit` is called.
   */
  emit(
    name: string,
    attributes?: Record<string, AttrValue | null | undefined>,
    timestamp?: number,
  ): void;
  /**
   * The OTel tracer of the SDK. The traces pipeline sends a completed span.
   * The SDK has no context manager, and thus its rule for the active span is
   * the time: a span from `startActiveSpan` is active from that call until its
   * `end()`, and a span from `startSpan` in that interval is its child. The
   * tracer ignores a context argument. During the first load, `pageLoad()`
   * keeps its root active, and thus a span of a custom instrumentation joins
   * the trace of the load.
   */
  tracer: Tracer;
  /** The current visitor id and session id. The code reads them at each call. */
  ids(): { visitorId: string; sessionId: string };
  /** The route pattern of the current page. It is null when the code finds
   * none. */
  route(): string | null;
  /**
   * The context of the current page: the pageview id, the url, the path, and
   * the referrer. It is the same data that the envelope writes. The code makes
   * a new context for each SPA navigation.
   */
  page(): PageContext;
  /**
   * Adds a listener for the SPA navigations. The SDK calls the listener after
   * it makes the new page context. Thus `page()` gives the new page. This
   * function returns the function that removes the listener.
   */
  onNavigation(listener: () => void): () => void;
  /**
   * Adds a listener for the hidden state: the `pagehide` event and the
   * `visibilitychange` event with the hidden state. The SDK calls the listener
   * before its exit flush. Thus a record that the listener sends goes in the
   * batch of that flush. This function returns the function that removes the
   * listener.
   */
  onHide(listener: () => void): () => void;
  /** The `dev` option of the WebSDK. */
  dev: boolean;
}

/**
 * An instrumentation is its setup function. The WebSDK constructor calls that
 * function. If the function returns a value, that value is the function that
 * stops the instrumentation.
 */
export type Instrumentation = (
  ctx: InstrumentationContext,
) => (() => void) | void;

export type { PageContext } from "../state/session.js";
