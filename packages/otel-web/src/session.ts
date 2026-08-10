// The session and the identity, on the current store (current.ts). There are
// three parts:
//
// - The page context: the pageview id, the url, and the referrer. It stays in
//   JS memory. It changes for each SPA navigation, and it ends at a reload or
//   when the user closes the tab.
// - `everr.visitor.id`: a random visitor id. It is an id for the device, and
//   the code never calculates it from a fingerprint. The code makes it when
//   the current store has none, then keeps it in memory. The
//   setPersistence() and revoke() functions read it again after a change of
//   the store.
// - `everr.session`: the session as `{ id, t }`, where `t` is the time of the
//   last activity. The session changes after the usual timeout of 30 minutes
//   without activity. Each record that the SDK sends is activity. Thus the
//   timeout measures an interval without activity, and not an interval of the
//   clock.
//
// The code does not store the identified user. The identify() function writes
// the `user.*` keys into the ambient set of setAttributes. Thus those keys stay
// in memory only, and the host identifies the user again at each page load.

import { getAttributes, setAttributes } from "./attributes.js";
import { currentStore, setStore, storeFor } from "./current.js";
import type { AttrValue } from "./emitter.js";
import type { Persistence, UserTraits } from "./types.js";

const VISITOR_KEY = "everr.visitor.id";
const SESSION_KEY = "everr.session";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The structure of a web-vitals metric id, without its version part. It
 * contains a timestamp and a random integer of 13 digits. The code makes it
 * quickly, and it is sufficiently different for an id that must only be
 * different from the other ids. Also, it does not need a secure context, but
 * crypto.randomUUID does.
 */
export const uniqueId = () =>
  `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

/** Hexadecimal data from the CSPRNG. The network and the tracer use it to
 * make the trace ids and the span ids. */
export function randomHex(bytes: number): string {
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(bytes))) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// The code keeps the visitor id in memory. The envelope reads that id for each
// record, and a read of the store for each record is not efficient. Only
// setPersistence() and revoke() change the store, and the two functions read
// the id again.
let visitor: string | undefined;

/** The current visitor id. If the current store has none, the code makes one. */
export function visitorId(): string {
  if (!visitor) {
    visitor = currentStore().read(VISITOR_KEY) ?? uniqueId();
    currentStore().write(VISITOR_KEY, visitor);
  }
  return visitor;
}

/** The session in the store: its id and the time of the last activity. */
type SessionState = { id: string; t: number };

// This keeps the session in memory when the store does not operate or when the
// code changed the store. Without it, the code makes a new session id for each
// record.
let memory: SessionState | null = null;

/** Finds the session id for the record that the SDK sends, and records the
 * activity. */
export function sessionId(): string {
  const store = currentStore();
  let base = memory;
  try {
    const parsed: { id?: unknown; t?: unknown } = JSON.parse(
      store.read(SESSION_KEY) ?? "null",
    );
    if (typeof parsed?.id === "string" && typeof parsed.t === "number")
      base = parsed as SessionState;
  } catch {
    // The data in the store is not correct. Use the session in memory, or make
    // a new session.
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
 * Changes the identity store during a session. The consent procedure uses
 * this: the app starts with `"memory"`, then it calls
 * `setPersistence("localStorage")` when the user gives consent.
 *
 * The current visitor id goes into the new store. But if the new store already
 * has a visitor id, that id stays. Thus a visitor who gives consent again keeps
 * the permanent id. The session continues, because the code keeps it in memory.
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
 * Identifies the user. The subsequent events carry `user.id` and the traits as
 * `user.*` attributes in the ambient set of setAttributes.
 *
 * A trait must be a single value, the same as in setAttributes. Put the dots
 * in the key yourself, for example `"company.name"`. The code does not change
 * the events that it sent before. A query connects the events later, and the
 * most recent data wins. Thus a second call to identify replaces all the
 * `user.*` keys.
 *
 * The code never puts this data in a store. The identification stays in memory
 * for the page, and thus the host identifies the user again at each page load.
 * The code writes `user.id` after the traits. Thus a trait with the name `id`
 * cannot replace it.
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
 * Removes the `user.*` ambient attributes. It also deletes each id in the
 * store: the visitor id and the session id. The current client keeps its ids in
 * memory, but it does not write them to the store again. The next WebSDK starts
 * with new ids.
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

/** Makes a new pageview id. The previous URL becomes the new referrer. */
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

// The callers always send location.href. The WebSDK constructor and the
// navigation watcher are the callers. Thus the URL is always absolute, and the
// code can always read it.
function pathOf(url: string): string {
  return new URL(url).pathname;
}
