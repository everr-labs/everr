// The identity store: where the visitor id and the session live. The
// `persistence` option selects the implementation. The interface is typed per
// value, and thus the serialization is a detail of the localStorage store. The
// memory store holds the values directly and serializes nothing.

import type { Persistence } from "./types.js";

/** The session in the store: its id and the time of the last activity. */
export type SessionState = { id: string; t: number };

export type IdentityStore = {
  readVisitor(): string | null;
  writeVisitor(id: string): void;
  /** Returns null when the store has no session or the data is not correct. */
  readSession(): SessionState | null;
  writeSession(state: SessionState): void;
  /** Removes all the identity data from the store. */
  clear(): void;
};

const VISITOR_KEY = "everr.visitor.id";
const SESSION_KEY = "everr.session";

// The code tries to use the store, but it accepts a failure. The localStorage
// store is not always available, for example in private mode or when the user
// stops the store. Then each read and each write fails, but the code throws no
// error. The identity then stays in memory for the life of the page.
const localStorageStore: IdentityStore = {
  readVisitor: () => {
    try {
      return localStorage.getItem(VISITOR_KEY);
    } catch {
      return null;
    }
  },
  writeVisitor: (id) => {
    try {
      localStorage.setItem(VISITOR_KEY, id);
    } catch {
      // The store is not available. The identity then stays in memory for the
      // life of the page.
    }
  },
  readSession: () => {
    try {
      const parsed: { id?: unknown; t?: unknown } = JSON.parse(
        localStorage.getItem(SESSION_KEY) ?? "null",
      );
      if (typeof parsed?.id === "string" && typeof parsed.t === "number")
        return parsed as SessionState;
    } catch {
      // The store is not available, or the data is not correct.
    }
    return null;
  },
  writeSession: (state) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // The same as above.
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(VISITOR_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // The same as above.
    }
  },
};

/** The memory store. The identity operates in the same way, but the ids end
 * with the page. */
function memoryStore(): IdentityStore {
  let visitor: string | null = null;
  let session: SessionState | null = null;
  return {
    readVisitor: () => visitor,
    writeVisitor: (id) => {
      visitor = id;
    },
    readSession: () => session,
    writeSession: (state) => {
      session = state;
    },
    clear: () => {
      visitor = null;
      session = null;
    },
  };
}

export function storeFor(persistence: Persistence | undefined): IdentityStore {
  return persistence === "memory" ? memoryStore() : localStorageStore;
}

// This is the default before the code constructs a WebSDK. Thus identify() and
// revoke() cause no error at that time. It is also the default after revoke(),
// which installs a new memory store. Thus the current client stops to write the
// ids to the store.
let store: IdentityStore = memoryStore();

export const currentStore = (): IdentityStore => store;

export function setStore(next: IdentityStore): void {
  store = next;
}
