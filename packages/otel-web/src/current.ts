// The current data of the SDK, in one module: the connection to the pipeline
// and the identity store. The package functions logger, captureError, identify,
// and sessionId read this data at each call. Thus each of them needs no code to
// change the connection. The WebSDK constructor connects in one place, and
// shutdown() disconnects in that same place. Also, the code can change the store
// during a session, and thus a consent procedure changes memory to localStorage
// without a new construction.
//
// Before the first connection, an emit gives a warning. Thus an incorrect setup
// is visible. After the code disconnects, an emit gives no warning. This is
// correct.

import type { Emit } from "./emitter.js";
import type { Persistence } from "./types.js";

let emit: Emit | undefined;
let started = false;

export function currentEmit(): Emit | undefined {
  if (!emit && !started) console.warn("[everr] SDK not initialized");
  return emit;
}

export function bindEmit(next: Emit): () => void {
  started = true;
  emit = next;
  return () => {
    emit = undefined;
  };
}

/** The location of the identity keys. The `persistence` option selects it. */
export type IdentityStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
};

// The code tries to use the store, but it accepts a failure. The localStorage
// store is not always available, for example in private mode or when the user
// stops the store. Then each read and each write fails, but the code throws no
// error. The identity then stays in memory for the life of the page.
const localStorageStore: IdentityStore = {
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
      // The store is not available. The identity then stays in memory for the
      // life of the page.
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // The same as above.
    }
  },
};

/** The memory store. The identity operates in the same way, but the ids end
 * with the page. */
function memoryStore(): IdentityStore {
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
