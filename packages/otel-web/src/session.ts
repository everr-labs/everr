// Session and identity, over the current store (current.ts). Three pieces:
//
// - The page context (pageview id, url, referrer): JS memory, rotates per
//   SPA navigation, dies on reload or tab close.
// - `everr.visitor.id`: a random visitor id (a device id, never
//   fingerprint-derived), minted when the current store has none and cached
//   in memory; setPersistence()/revoke() refresh the cache on a switch.
// - `everr.session`: the session as `{ id, t }` (last activity), rotated
//   after the standard 30-minute inactivity timeout. Every emitted record
//   is activity, so the timeout is an idle gap, not a wall clock.
//
// The identified user is not stored at all: identify() writes `user.*`
// keys into the setAttributes ambient set, so it is memory-only and the
// host re-identifies per page load.

import { getAttributes, setAttributes } from "./attributes.js";
import { currentStore, setStore, storeFor } from "./current.js";
import type { AttrValue } from "./emitter.js";
import type { Persistence, UserTraits } from "./types.js";

const VISITOR_KEY = "everr.visitor.id";
const SESSION_KEY = "everr.session";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * web-vitals' metric id shape minus its version tag: a timestamp plus a
 * 13-digit random integer, cheap to generate, unique enough for ids that
 * only ever need to be distinct, and free of the secure-context requirement
 * crypto.randomUUID carries.
 */
export const uniqueId = () =>
  `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

/** CSPRNG hex, shared by the trace/span id minters (network, tracer). */
export function randomHex(bytes: number): string {
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(bytes))) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// Cached: the envelope samples the visitor id per record, and a storage
// read per record would be waste; setPersistence()/revoke() are the only
// store switches and both refresh the cache.
let visitor: string | undefined;

/** The current visitor id, minted into the current store when absent. */
export function visitorId(): string {
  if (!visitor) {
    visitor = currentStore().read(VISITOR_KEY) ?? uniqueId();
    currentStore().write(VISITOR_KEY, visitor);
  }
  return visitor;
}

// In-memory continuity for when storage is unusable or was just switched:
// without this fallback every record would mint a fresh session id.
let memory: { id: string; t: number } | null = null;

/** Resolves the session id for the record being emitted, touching activity. */
export function sessionId(): string {
  const store = currentStore();
  let base = memory;
  try {
    const parsed: { id?: unknown; t?: unknown } = JSON.parse(
      store.read(SESSION_KEY) ?? "null",
    );
    if (typeof parsed?.id === "string" && typeof parsed.t === "number")
      base = parsed as { id: string; t: number };
  } catch {
    // Corrupt stored state: fall through to memory or a fresh session.
  }
  const now = Date.now();
  const next =
    base && now - base.t <= SESSION_TIMEOUT_MS
      ? { id: base.id, t: now }
      : { id: uniqueId(), t: now };
  store.write(SESSION_KEY, JSON.stringify(next));
  memory = next;
  return next.id;
}

/**
 * Switches the identity store mid-session (the consent flow: boot with
 * `"memory"`, call `setPersistence("localStorage")` once consent lands).
 * The live visitor id carries into the new store unless it already holds
 * one (a returning consented visitor keeps their durable id); the session
 * carries over through its in-memory continuity.
 */
export function setPersistence(persistence: Persistence | undefined): void {
  const id = visitorId();
  setStore(storeFor(persistence));
  visitor = currentStore().read(VISITOR_KEY) ?? id;
  currentStore().write(VISITOR_KEY, visitor);
}

const clearUser = (): void => {
  const set = getAttributes();
  for (const key of Object.keys(set)) {
    if (key.startsWith("user.")) delete set[key];
  }
};

/**
 * Identifies the user: subsequent events carry `user.id` and the traits as
 * `user.*` attributes in the setAttributes ambient set. Traits are flat
 * scalars, same as setAttributes (dot the keys yourself: `"company.name"`).
 * Already-emitted events are untouched (stitching is query-time,
 * latest-wins: a re-identify replaces the whole `user.*` namespace). Never
 * persisted: the identification lives in memory for the page, so the host
 * re-identifies per page load. `user.id` is stamped after the traits so a
 * trait named `id` cannot shadow it.
 */
export function identify(userId: string, traits?: UserTraits): void {
  clearUser();
  const user: Record<string, AttrValue | null> = {};
  for (const [key, value] of Object.entries(traits ?? {})) {
    user[`user.${key}`] = value;
  }
  user["user.id"] = userId;
  setAttributes(user);
}

/**
 * Clears the `user.*` ambient attributes and deletes every stored id
 * (visitor, session). The live client keeps its in-memory ids but stops
 * re-persisting them; the next WebSDK starts fresh.
 */
export function revoke(): void {
  clearUser();
  const store = currentStore();
  store.remove(VISITOR_KEY);
  store.remove(SESSION_KEY);
  visitor = undefined;
  memory = null;
  setStore(storeFor("memory"));
}

export type PageContext = {
  readonly pageViewId: string;
  readonly url: string;
  readonly path: string;
  readonly referrer: string | undefined;
};

/** Rotates the pageview id; the outgoing URL becomes the new referrer. */
export type RotatePageView = (url: string) => void;
export type CurrentPage = () => PageContext;

export function createSessionContext(
  initialUrl: string,
  initialReferrer: string | undefined,
): [rotate: RotatePageView, current: CurrentPage] {
  let ctx = {
    pageViewId: uniqueId(),
    url: initialUrl,
    path: pathOf(initialUrl),
    referrer: initialReferrer || undefined,
  };

  return [
    (url) => {
      ctx = {
        pageViewId: uniqueId(),
        url,
        path: pathOf(url),
        referrer: ctx.url,
      };
    },
    () => ctx,
  ];
}

// Always fed location.href (WebSDK construction and the navigation watcher), so the URL
// is absolute and parseable by construction.
function pathOf(url: string): string {
  return new URL(url).pathname;
}
