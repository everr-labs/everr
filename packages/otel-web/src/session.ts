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
import type { AttrValue } from "./emitter.js";
import {
  currentStore,
  type SessionState,
  setStore,
  storeFor,
} from "./store.js";
import type { Persistence, UserTraits } from "./types.js";

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
    visitor = currentStore().readVisitor() ?? uniqueId();
    currentStore().writeVisitor(visitor);
  }
  return visitor;
}

// This keeps the session in memory when the store does not operate or when the
// code changed the store. Without it, the code makes a new session id for each
// record.
let session: SessionState | null = null;

// The time between two writes of the activity to the store. localStorage
// operates in sequence with the page, and thus each write stops the main
// thread. The activity value only decides a limit of 30 minutes, and thus a
// write for each record gives much more accuracy than the limit needs. A page
// with the interactions, the network, and the performance instrumentations
// sends many records in each minute, and without this delay each one is a
// read-modify-write on the main thread.
//
// The effect of the delay is a value in the store that is a maximum of
// STORAGE_WRITE_DELAY_MS behind the true activity. Thus a session limit can
// occur a maximum of 30 seconds early, in a window of 30 minutes.
const STORAGE_WRITE_DELAY_MS = 30_000;
let lastWrite = 0;

/**
 * Finds the session id for the record that the SDK sends, and records the
 * activity.
 *
 * The code reads the store for each record, because a different tab can move
 * the session. But it writes the store on a delay. Two conditions write
 * immediately: a new session id, which no other tab can find in memory, and the
 * exit path through persistSession().
 */
export function sessionId(): string {
  const store = currentStore();
  const base = store.readSession() ?? session;
  const now = Date.now();
  const next =
    base && now - base.t <= SESSION_TIMEOUT_MS
      ? { id: base.id, t: now }
      : { id: uniqueId(), t: now };
  session = next;
  if (next.id !== base?.id || now - lastWrite >= STORAGE_WRITE_DELAY_MS) {
    lastWrite = now;
    store.writeSession(next);
  }
  return next.id;
}

/**
 * Writes the session in memory to the store immediately. The client calls this
 * on the exit path, before the flush at exit. Thus the last activity of the
 * page goes to the store, and the delay above cannot make the session end too
 * early after the user comes back.
 */
export function persistSession(): void {
  if (!session) return;
  lastWrite = Date.now();
  currentStore().writeSession(session);
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
  visitor = currentStore().readVisitor() ?? id;
  currentStore().writeVisitor(visitor);
  // The new store has no session. The write of the activity is on a delay, and
  // thus the code writes the session now. Without this step a reload in the
  // period of the delay finds no session and makes a new one.
  persistSession();
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
  currentStore().clear();
  visitor = undefined;
  session = null;
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
