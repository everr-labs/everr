import type { AttrValue } from "./emitter.js";
import { randomUUID, type SessionProvider } from "./session.js";
import type { UserTraits } from "./types.js";

// Consented-mode durable identity, backed by localStorage (so it survives
// reloads and is shared across tabs of the same origin). Three keys:
//
// - `everr.visitor.id`: a random persistent visitor id (a device id, never
//   fingerprint-derived), minted on first consented init.
// - `everr.session`: the durable session as `{ id, t }` (last activity),
//   rotated after the standard 30-minute inactivity timeout. Every emitted
//   record is activity, so the timeout is an idle gap, not a wall clock.
// - `everr.user`: the identified user as `{ id, traits }`, written by
//   identify() and read back on the next init.
//
// Storage access is best-effort: when localStorage is unavailable (private
// mode, disabled storage) every read/write fails softly and identity
// degrades to in-memory state for the page's life, never a throw.
//
// revoke() deletes the stored ids only. It never downgrades the live client
// in place: the host's CMP drives the transition by reloading and
// re-initializing in cookieless mode.

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

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: identity degrades to in-memory for the page life.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

function readJson<T>(
  key: string,
  valid: (parsed: unknown) => parsed is T,
): T | null {
  try {
    const raw = read(key);
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

export function createIdentity(): Identity {
  const storedVisitorId = read(VISITOR_KEY);
  const visitorId = storedVisitorId ?? randomUUID();
  if (!storedVisitorId) write(VISITOR_KEY, visitorId);

  // In-memory continuity for when storage is unusable: readSession() then
  // always returns null, and without this fallback every record would mint
  // a fresh session id.
  let memory: StoredSession | null = null;

  const session = (): string => {
    const now = Date.now();
    const stored = readJson(SESSION_KEY, isSession);
    const base = stored ?? memory;
    const next =
      base && now - base.t <= SESSION_TIMEOUT_MS
        ? { id: base.id, t: now }
        : { id: randomUUID(), t: now };
    write(SESSION_KEY, JSON.stringify(next));
    memory = next;
    return next.id;
  };

  let user: StoredUser | null = readJson(USER_KEY, isUser);

  return {
    session,
    attrs: () => ({
      ...flattenUser(user),
      "everr.visitor.id": visitorId,
    }),
    identify: (userId, traits) => {
      // Latest-wins: the stored identity mirrors the last identify() call;
      // there is no merging and no set_once (profiles are a query-time
      // construct over the stamped events).
      user = traits === undefined ? { id: userId } : { id: userId, traits };
      write(USER_KEY, JSON.stringify(user));
    },
    revoke: () => {
      remove(VISITOR_KEY);
      remove(SESSION_KEY);
      remove(USER_KEY);
    },
  };
}
