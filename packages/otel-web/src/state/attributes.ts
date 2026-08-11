// The ambient context that is not the identity: the tenant, the feature flags,
// and the experiment groups. The setAttributes() function is equivalent to
// identify(), but it is for all the data that does not give the identity of the
// user.
//
// This is usual module data, the same as the route resolver. It stays in memory
// only, and it ends with the page. It continues after shutdown() and after a
// new construction, and this is correct: a consent procedure constructs the SDK
// again, and the context of the host stays. The envelope reads this data for
// each record. Thus each subsequent record carries it. If a record has an
// attribute with the same key, the attribute of the record wins.

import type { AttrValue } from "../pipeline/emitter.js";

const set: Record<string, AttrValue> = {};

/**
 * Sets the ambient context attributes. The SDK writes them on each subsequent
 * record. Use single keys, and do not make a structure.
 *
 * Each call merges the attributes, but it does not merge the values inside an
 * attribute. A value of `null` removes that key. The code never puts this data
 * in a store: the set stays in memory, and it ends with the page. The `user.*`
 * keys belong to `identify()`. If you use one of those keys here, you are
 * responsible for the result.
 */
export function setAttributes(
  attributes: Record<string, AttrValue | null>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null) delete set[key];
    else set[key] = value;
  }
}

/** The current ambient set. The envelope reads it for each record. */
export const getAttributes = (): Record<string, AttrValue> => set;
