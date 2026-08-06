// The plugin contract: init() runs each plugin's setup against a
// deliberately small context (seven members, nothing else: no transport, no
// batcher, no record internals), and shutdown() runs the returned teardowns
// in reverse order before the pipeline unbinds. A consent re-init tears
// every plugin down and sets it up again, so plugins inherit the new
// persistence mode for free. The array is taken verbatim, duplicates
// included, and setup/teardown run unguarded: a throwing plugin is the
// caller's bug, not the runtime's to paper over.

import type { Tracer } from "@opentelemetry/api";
import type { AttrValue } from "../emitter.js";
import type { PageContext } from "../session.js";

/**
 * What a plugin's `setup` receives. Everything a capture source needs, and
 * deliberately nothing more.
 */
export interface PluginContext {
  /**
   * Emits an event record through the standard pipeline: the ambient
   * envelope (session, page, route, identity, `setAttributes` context) is
   * stamped and the record is batched with everything else. Nullish
   * attribute values are skipped, so optional attributes need no ceremony.
   */
  emit(
    name: string,
    attributes?: Record<string, AttrValue | null | undefined>,
  ): void;
  /** The SDK's OTel tracer; finished spans ride the traces pipeline. */
  tracer: Tracer;
  /** The current visitor and session ids (sampled per call). */
  ids(): { visitorId: string; sessionId: string };
  /** The current route resolver result, or null when none is registered. */
  route(): string | null;
  /**
   * The current page context (pageview id, url, path, referrer): the same
   * snapshot the envelope stamps, rotated per SPA navigation.
   */
  page(): PageContext;
  /**
   * Subscribes to SPA navigations, after the page context has rotated (so
   * `page()` already reads the new page). Returns the unsubscribe.
   */
  onNavigation(listener: () => void): () => void;
  /** The init option's development mode. */
  dev: boolean;
}

export interface Plugin {
  name: string;
  /** Runs during init(); the return value is the teardown. */
  setup(ctx: PluginContext): (() => void) | void;
}

export type { PageContext } from "../session.js";
