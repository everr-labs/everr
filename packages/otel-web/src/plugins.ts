// The plugin runtime: init() runs each plugin's setup against a deliberately
// small context (five members, nothing else: no transport, no batcher, no
// record internals, no hook registration), and shutdown() runs the returned
// teardowns in reverse order before the base capture unpatches. A consent
// re-init tears every plugin down and sets it up again, so plugins inherit
// the new persistence mode for free. The array is taken verbatim, duplicates
// included, and setup/teardown run unguarded: a throwing plugin is the
// caller's bug, not the runtime's to paper over.

import type { Tracer } from "@opentelemetry/api";
import type { AttrValue, Emit, EventName } from "./emitter.js";
import { routePattern } from "./route.js";
import { sessionId, visitorId } from "./session.js";

/**
 * What a plugin's `setup` receives. Everything a capture source needs, and
 * deliberately nothing more.
 */
export interface PluginContext {
  /**
   * Emits an event record through the standard pipeline: the ambient
   * envelope (session, page, route, identity, `setAttributes` context) is
   * stamped and the record is batched with everything else.
   */
  emit(name: string, attributes?: Record<string, AttrValue>): void;
  /** The SDK's OTel tracer; finished spans ride the traces pipeline. */
  tracer: Tracer;
  /** The current visitor and session ids (sampled per call). */
  ids(): { visitorId: string; sessionId: string };
  /** The current route resolver result, or null when none is registered. */
  route(): string | null;
  /** The init option's development mode. */
  dev: boolean;
}

export interface Plugin {
  name: string;
  /** Runs during init(); the return value is the teardown. */
  setup(ctx: PluginContext): (() => void) | void;
}

export function startPlugins(
  plugins: Plugin[] | undefined,
  emit: Emit,
  tracer: Tracer,
  dev: boolean,
): () => void {
  // One context serves every plugin: ids and route sample the live module
  // state directly, and the EventName union is a compile-time taxonomy for
  // the built-ins, so plugin names pass through with a cast.
  const ctx: PluginContext = {
    emit: (name, attributes) => emit(name as EventName, attributes),
    tracer,
    ids: () => ({ visitorId: visitorId(), sessionId: sessionId() }),
    route: () => routePattern() ?? null,
    dev,
  };
  const teardowns: Array<() => void> = [];
  for (const plugin of plugins ?? []) {
    const teardown = plugin.setup(ctx);
    if (teardown) teardowns.push(teardown);
  }

  return () => {
    for (let i = teardowns.length - 1; i >= 0; i--) teardowns[i]();
  };
}
