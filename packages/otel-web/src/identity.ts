import type { AttrValue } from "./emitter.js";
import { type SessionProvider, uniqueId } from "./session.js";
import type { Persistence, UserTraits } from "./types.js";

// Identity (visitor id, session, identified user) over a pluggable store:
// localStorage persistence survives reloads and is shared across tabs of the
// same origin; memory persistence keeps the same ids in a Map that dies with
// the page. Three keys:
//
// - `everr.visitor.id`: a random visitor id (a device id, never
//   fingerprint-derived), minted on init when the store has none.
// - `everr.session`: the session as `{ id, t }` (last activity), rotated
//   after the standard 30-minute inactivity timeout. Every emitted record is
//   activity, so the timeout is an idle gap, not a wall clock.
// - `everr.user`: the identified user as `{ id, traits }`, written by
//   identify() and read back on the next init.
//
// Storage access is best-effort: when localStorage is unavailable (private
// mode, disabled storage) every read/write fails softly and identity
// degrades to in-memory state for the page's life, never a throw.
//
// revoke() deletes the stored ids only. It never downgrades the live client
// in place: the host drives the transition by reloading and re-initializing
// with memory persistence.

const VISITOR_KEY = "everr.visitor.id";
const SESSION_KEY = "everr.session";
const USER_KEY = "everr.user";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export type Identity = {
  /** Durable session: rotates on a 30-minute idle gap, touched per record. */
  session: SessionProvider;
  /**
   * Identity attributes stamped per record: `everr.visitor.id` always,
   * `user.id` and flattened `user.*` traits once identify() has run.
   */
  attrs: () => Record<string, AttrValue>;
  identify: (userId: string, traits?: UserTraits) => void;
  revoke: () => void;
};

type StoredSession = { id: string; t: number };
type StoredUser = { id: string; traits?: UserTraits };

/** Where identity keys live; picked by the `persistence` init option. */
export type IdentityStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
};

export const localStorageStore: IdentityStore = {
  read: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: identity degrades to in-memory for the page life.
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
};

/** Memory persistence: same identity semantics, ids die with the page. */
export function memoryStore(): IdentityStore {
  const map = new Map<string, string>();
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

function readJson<T>(
  store: IdentityStore,
  key: string,
  valid: (parsed: unknown) => parsed is T,
): T | null {
  try {
    const raw = store.read(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isSession = (parsed: unknown): parsed is StoredSession =>
  typeof parsed === "object" &&
  parsed !== null &&
  typeof (parsed as StoredSession).id === "string" &&
  typeof (parsed as StoredSession).t === "number";

const isUser = (parsed: unknown): parsed is StoredUser =>
  typeof parsed === "object" &&
  parsed !== null &&
  typeof (parsed as StoredUser).id === "string";

// Traits flatten to dotted `user.*` keys, scalars only: nested plain objects
// recurse (depth-capped), arrays and nullish leaves are dropped. `user.id`
// is stamped after the traits so a trait named `id` cannot shadow it.
const MAX_TRAIT_DEPTH = 5;

function flattenUser(user: StoredUser | null): Record<string, AttrValue> {
  if (!user) return {};
  const out: Record<string, AttrValue> = {};
  const walk = (prefix: string, value: unknown, depth: number): void => {
    if (value == null) return;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[prefix] = value;
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      depth < MAX_TRAIT_DEPTH
    ) {
      for (const [key, nested] of Object.entries(value)) {
        walk(`${prefix}.${key}`, nested, depth + 1);
      }
    }
  };
  for (const [key, value] of Object.entries(user.traits ?? {})) {
    walk(`user.${key}`, value, 1);
  }
  out["user.id"] = user.id;
  return out;
}

/** The store the `persistence` init option picks. */
export function storeFor(persistence: Persistence | undefined): IdentityStore {
  return persistence === "memory" ? memoryStore() : localStorageStore;
}

export function createIdentity(initialStore: IdentityStore): Identity {
  // revoke() swaps this for a fresh memory store: the live client keeps its
  // session and user (never downgrades in place) but must not re-persist
  // them, or the next init would read the revoked ids back instead of
  // starting fresh.
  let store = initialStore;

  const storedVisitorId = store.read(VISITOR_KEY);
  const visitorId = storedVisitorId ?? uniqueId();
  if (!storedVisitorId) store.write(VISITOR_KEY, visitorId);

  // In-memory continuity for when storage is unusable: readJson() then
  // always returns null, and without this fallback every record would mint
  // a fresh session id.
  let memory: StoredSession | null = null;

  const session = (): string => {
    const now = Date.now();
    const base = readJson(store, SESSION_KEY, isSession) ?? memory;
    const next =
      base && now - base.t <= SESSION_TIMEOUT_MS
        ? { id: base.id, t: now }
        : { id: uniqueId(), t: now };
    store.write(SESSION_KEY, JSON.stringify(next));
    memory = next;
    return next.id;
  };

  // attrs() runs per emitted record but its value changes only on
  // identify(), so the flattened form is rebuilt eagerly there and served
  // as-is from the hot path.
  const stamp = (user: StoredUser | null) => ({
    ...flattenUser(user),
    "everr.visitor.id": visitorId,
  });
  let attrs = stamp(readJson(store, USER_KEY, isUser));

  return {
    session,
    attrs: () => attrs,
    identify: (userId, traits) => {
      // Latest-wins: the stored identity mirrors the last identify() call;
      // there is no merging and no set_once (profiles are a query-time
      // construct over the stamped events).
      const user: StoredUser =
        traits === undefined ? { id: userId } : { id: userId, traits };
      attrs = stamp(user);
      store.write(USER_KEY, JSON.stringify(user));
    },
    revoke: () => {
      store.remove(VISITOR_KEY);
      store.remove(SESSION_KEY);
      store.remove(USER_KEY);
      store = memoryStore();
    },
  };
}

// The public identify()/revoke() surface: module-level live bindings, the
// same pattern as `report` (errors.ts) and `log` (logger.ts). Identity
// capability lives off to the side instead of on the handle returned by
// init(), matching the rest of the public API.
let liveIdentify: Identity["identify"] = () =>
  console.warn("[everr] SDK not initialized");
let liveRevoke: Identity["revoke"] = () =>
  console.warn("[everr] SDK not initialized");

/**
 * Identifies the user: subsequent events carry `user.id` and the traits
 * flattened as `user.*` attributes. Already-emitted events are untouched
 * (stitching is query-time, latest-wins). With localStorage persistence the
 * identification survives reloads until `revoke()`; with memory persistence
 * it lives for the page only. Before a browser client has initialized this
 * warns (never throws), and after its `shutdown()` it goes silent, same as
 * `captureError()` and `logger`.
 */
export function identify(userId: string, traits?: UserTraits): void {
  liveIdentify(userId, traits);
}

/**
 * Deletes every stored id (visitor, session, user). Never downgrades the
 * live client in place: the host drives the transition by reloading and
 * re-initializing with memory persistence.
 */
export function revoke(): void {
  liveRevoke();
}

/**
 * Wires identify()/revoke() to a live identity for the life of one init()
 * call. The returned unbind goes silent rather than reverting to the
 * pre-init warning, matching startErrors/startLogger.
 */
export function bindIdentity(
  identity: Pick<Identity, "identify" | "revoke">,
): () => void {
  liveIdentify = identity.identify;
  liveRevoke = identity.revoke;
  return () => {
    liveIdentify = () => {};
    liveRevoke = () => {};
  };
}
