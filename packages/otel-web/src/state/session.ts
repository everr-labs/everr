// The session and the identity. The `anonymized` variable below is the one
// place that holds the mode, and the other values depend on it. There are four
// parts:
//
// - The page context: the pageview id, the url, and the referrer. It stays in
//   JS memory. It changes for each SPA navigation, and it ends at a reload or
//   when the user closes the tab.
// - `everr.visitor.id`: a random visitor id. It is an id for the device, and
//   the code never calculates it from a fingerprint. It exists only when the
//   mode is not anonymized. The code makes it when localStorage has none, then
//   keeps it in memory.
// - `everr.session`: the session as `{ id, t }`, where `t` is the time of the
//   last activity. The session changes after the usual timeout of 30 minutes
//   without activity. Each record that the SDK sends is activity. Thus the
//   timeout measures an interval without activity, and not an interval of the
//   clock. While anonymized, the session stays in memory only.
// - The identified user: the `user.*` keys from identify(). They stay in memory
//   only, and the host identifies the user again at each page load. The
//   envelope sends them only when the mode is not anonymized.

import type { AttrValue } from "../pipeline/emitter.js";
import type { UserTraits } from "../types.js";
import {
  readSession,
  readVisitor,
  removeIdentity,
  type SessionState,
  writeSession,
  writeVisitor,
} from "./store.js";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The structure of a web-vitals metric id, without its version part. It
 * contains a timestamp and a random integer of 13 digits. The code makes it
 * quickly, and it is sufficiently different for an id that must only be
 * different from the other ids. Also, it does not need a secure context, but
 * crypto.randomUUID does.
 */
export const uniqueId = () => `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

/** Hexadecimal data from the CSPRNG. The network and the tracer use it to
 * make the trace ids and the span ids. */
export function randomHex(bytes: number): string {
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(bytes))) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// The mode. While it is true, the code reads, writes, and removes nothing in
// localStorage, and it sends no visitor id and no `user.*` key. Only
// setAnonymized() changes it.
let anonymized = true;

// The code keeps the visitor id in memory. The envelope reads that id for each
// record, and a read of the store for each record is not efficient. Only
// setAnonymized() and clearIdentity() change the id, and the two functions keep
// this variable correct.
let visitor: string | undefined;

/** The current visitor id. It is undefined while anonymized. If localStorage
 * has no id, the code makes one. */
export function visitorId(): string | undefined {
  if (anonymized) return undefined;
  if (!visitor) {
    visitor = readVisitor() ?? uniqueId();
    writeVisitor(visitor);
  }
  return visitor;
}

// This keeps the session in memory. While anonymized it is the only place of
// the session. When the mode is not anonymized, it also serves a storage that
// does not operate. Without it, the code makes a new session id for each
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
// The code measures the delay from the activity that the store holds, and not
// from the time of the last write. persistSession() can write an activity that
// is older than its write, and the next record must then write again.
//
// The effect of the delay is a value in the store that is a maximum of
// STORAGE_WRITE_DELAY_MS behind the true activity. Thus a session limit can
// occur a maximum of 30 seconds early, in a window of 30 minutes.
const STORAGE_WRITE_DELAY_MS = 30_000;

/**
 * Finds the session id for the record that the SDK sends, and records the
 * activity.
 *
 * When the mode is not anonymized, the code reads the store for each record,
 * because a different tab can move the session. But it writes the store on a
 * delay. Two conditions write immediately: a new session id, which no other tab
 * can find in memory, and the exit path through persistSession().
 */
export function sessionId(): string {
  const base = (anonymized ? null : readSession()) ?? session;
  const now = Date.now();
  const next =
    base && now - base.t <= SESSION_TIMEOUT_MS
      ? { id: base.id, t: now }
      : { id: uniqueId(), t: now };
  session = next;
  if (!anonymized && (next.id !== base?.id || now - base.t >= STORAGE_WRITE_DELAY_MS)) {
    writeSession(next);
  }
  return next.id;
}

/**
 * Writes the session in memory to the store immediately. The client calls this
 * on the exit path, before the flush at exit. Thus the last activity of the
 * page goes to the store, and the delay above cannot make the session end too
 * early after the user comes back. It does nothing while anonymized.
 */
export function persistSession(): void {
  if (!session || anonymized) return;
  writeSession(session);
}

// The user from identify(). The envelope reads it through userAttributes().
let user: Record<string, AttrValue> = {};

/** The identified user, as `user.*` attributes. It is undefined while
 * anonymized. */
export const userAttributes = (): Record<string, AttrValue> | undefined =>
  anonymized ? undefined : user;

// The code forgets the ids in memory, and it removes the stored ids when the
// mode is not anonymized. The next record then gets a new session id.
function forgetIds(): void {
  if (!anonymized) removeIdentity();
  visitor = undefined;
  session = null;
}

/**
 * Changes the mode during a session. The consent procedure uses this: the app
 * starts anonymized, then it calls `setAnonymized(false)` when the user gives
 * consent. A call with the current value does nothing.
 *
 * To leave the mode, the visitor id is the id that localStorage already has, or
 * a new id, and the code writes it. The session continues with the same id,
 * because the code keeps it in memory, and the code writes it now. The user
 * from an earlier identify() goes on the next record.
 *
 * To enter the mode, the code removes the stored ids and forgets the visitor
 * id. It also drops the session. The old session id would join the new records
 * to the visitor and the user on the earlier records. The next record gets a
 * new session id. The code keeps the identified user in memory, but it does not
 * send it.
 */
export function setAnonymized(next: boolean): void {
  if (next === anonymized) return;
  if (next) forgetIds();
  anonymized = next;
  if (!next) {
    visitorId();
    persistSession();
  }
}

/**
 * Identifies the user. The subsequent events carry `user.id` and the traits as
 * `user.*` attributes, but only when the mode is not anonymized.
 *
 * A trait must be a single value, the same as in setAttributes. Put the dots
 * in the key yourself, for example `"company.name"`. The code does not change
 * the events that it sent before. A query connects the events later, and the
 * most recent data wins. Thus a second call to identify replaces all the
 * `user.*` keys.
 *
 * The code never puts this data in a store, in any mode. The identification
 * stays in memory for the page, and thus the host identifies the user again at
 * each page load. The code writes `user.id` after the traits. Thus a trait with
 * the name `id` cannot replace it.
 */
export function identify(userId: string, traits?: UserTraits): void {
  const next: Record<string, AttrValue> = {};
  for (const [key, value] of Object.entries(traits ?? {})) {
    if (value !== null) next[`user.${key}`] = value;
  }
  next["user.id"] = userId;
  user = next;
}

/**
 * Forgets the identified user, the visitor id, and the session, and it removes
 * the stored ids when the mode is not anonymized. It never changes the mode.
 * Call it when the user logs out. The subsequent records carry new ids.
 */
export function clearIdentity(): void {
  user = {};
  forgetIds();
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
