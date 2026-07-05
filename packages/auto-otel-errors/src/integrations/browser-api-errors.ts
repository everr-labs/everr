import type { Integration } from "../types.js";

type AnyFn = (...args: unknown[]) => unknown;

// Narrows an unknown value to a callable without a type assertion.
const isFn = (value: unknown): value is AnyFn => typeof value === "function";

// Wrapped event listeners keyed by the original function, so removeEventListener
// can find the wrapper and re-adds reuse one — without mutating user functions.
const wrappedListeners = new WeakMap<AnyFn, AnyFn>();

/**
 * Wraps `setTimeout`, `setInterval`, `requestAnimationFrame`, and
 * `EventTarget.addEventListener` callbacks so errors thrown inside them are
 * captured with their real stack (e.g. cross-origin "Script error." cases the
 * window "error" handler can't see) and a `browserapi` mechanism. The error is
 * re-thrown so app behaviour is unchanged; it is marked on the client so the
 * window "error" handler skips the duplicate.
 */
export function browserApiErrorsIntegration(): Integration {
  const restores: Array<() => void> = [];

  return {
    name: "browserApiErrors",
    setup(client) {
      const wrap = (fn: AnyFn): AnyFn =>
        function (this: unknown, ...args: unknown[]) {
          try {
            return fn.apply(this, args);
          } catch (error) {
            client.capture({ error, mechanism: "browserapi", handled: false });
            client.markCaptured(error);
            throw error;
          }
        };

      patchGlobalCallback(restores, "setTimeout", wrap);
      patchGlobalCallback(restores, "setInterval", wrap);
      patchGlobalCallback(restores, "requestAnimationFrame", wrap);
      patchEventTarget(restores, wrap);
    },
    teardown() {
      for (const restore of restores) {
        restore();
      }
      restores.length = 0;
    },
  };
}

// Patches a global whose first argument is a callback (setTimeout, setInterval,
// requestAnimationFrame), wrapping that callback to capture thrown errors.
function patchGlobalCallback(
  restores: Array<() => void>,
  name: "setTimeout" | "setInterval" | "requestAnimationFrame",
  wrap: (fn: AnyFn) => AnyFn,
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- globalThis has no string index signature; monkey-patching global builtins by name needs an indexable view
  const host = globalThis as unknown as Record<string, unknown>;
  const original = host[name];
  if (!isFn(original)) {
    return;
  }

  host[name] = function (this: unknown, handler: unknown, ...rest: unknown[]) {
    const callback = isFn(handler) ? wrap(handler) : handler;
    return original.call(this, callback, ...rest);
  };
  restores.push(() => {
    host[name] = original;
  });
}

function patchEventTarget(restores: Array<() => void>, wrap: (fn: AnyFn) => AnyFn): void {
  if (
    typeof EventTarget === "undefined" ||
    typeof EventTarget.prototype.addEventListener !== "function"
  ) {
    return;
  }

  const proto = EventTarget.prototype;
  const originalAdd = proto.addEventListener;
  const originalRemove = proto.removeEventListener;

  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    // Only wrap plain function listeners; pass handleEvent objects through.
    if (isFn(listener)) {
      const fn = listener;
      let wrapped = wrappedListeners.get(fn);
      if (!wrapped) {
        wrapped = wrap(fn);
        wrappedListeners.set(fn, wrapped);
      }
      return originalAdd.call(this, type, wrapped, options);
    }
    return originalAdd.call(this, type, listener, options);
  };

  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (isFn(listener)) {
      const wrapped = wrappedListeners.get(listener);
      if (wrapped) {
        return originalRemove.call(this, type, wrapped, options);
      }
    }
    return originalRemove.call(this, type, listener, options);
  };

  restores.push(() => {
    proto.addEventListener = originalAdd;
    proto.removeEventListener = originalRemove;
  });
}
