// The live state of the SDK, in one module: the current pipeline binding
// and the current identity store. Package-level surfaces (logger,
// captureError, identify, sessionId) sample this state per call instead of
// each keeping swap machinery, so WebSDK construction/shutdown() bind and unbind in
// exactly one place, and the store can be switched mid-session (a consent
// flow upgrades memory to localStorage without re-initializing). Emit warns
// before the first bind (miswiring stays visible), silent after unbind, by
// design.

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

/** Where identity keys live; picked by the `persistence` option. */
export type IdentityStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
};

// Storage access is best-effort: when localStorage is unavailable (private
// mode, disabled storage) every read/write fails softly and identity
// degrades to in-memory state for the page's life, never a throw.
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

// The pre-construction default keeps identify()/revoke() harmless before a WebSDK exists and
// after revoke() (which swaps a fresh memory store in so the live client
// stops re-persisting).
let store: IdentityStore = memoryStore();

export const currentStore = (): IdentityStore => store;

export function setStore(next: IdentityStore): void {
  store = next;
}
