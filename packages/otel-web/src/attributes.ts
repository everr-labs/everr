// Ambient non-identity context (tenant, feature flags, experiment arms):
// setAttributes() is identify()'s sibling for everything that is not who the
// user is. Plain module state like the route resolver: memory only, dies
// with the page, deliberately survives shutdown()/re-init (a consent flow
// re-initializes the SDK without losing the host's context). The envelope
// samples it per record, so every subsequently emitted record carries it
// and per-record attributes win on collision.

import type { AttrValue } from "./emitter.js";

const set: Record<string, AttrValue> = {};

/**
 * Sets ambient context attributes stamped onto every subsequently emitted
 * record (flat keys, no nesting). Calls merge shallowly; a `null` value
 * clears that key. Never persisted: the set lives in memory and dies with
 * the page. The `user.*` namespace belongs to `identify()`; keys collide
 * at the caller's own risk.
 */
export function setAttributes(
  attributes: Record<string, AttrValue | null>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null) delete set[key];
    else set[key] = value;
  }
}

/** The current ambient set, sampled per record by the envelope. */
export const getAttributes = (): Record<string, AttrValue> => set;
