// A long-lived singleton (e.g. a background runner) booted as a side effect of
// module evaluation gets re-created on every Vite hot update. This helper owns
// the three things that makes that awkward: state that must survive module
// re-evaluation, serialization of stop->start so two instances never overlap,
// and the import.meta.hot wiring. Consumers only declare how to start and stop
// the resource.

// Structural subset of Vite's import.meta.hot that we actually use, so the
// helper does not depend on a specific Vite type path.
interface HotContext {
  accept(): void;
  dispose(cb: (data: unknown) => void): void;
}

interface HotSingletonOptions<T> {
  // Registry slot; identifies the singleton across module re-evaluations.
  key: string;
  start: () => Promise<T>;
  stop: (value: T) => Promise<void>;
  // import.meta.hot for a live resource that must stay up across edits;
  // undefined outside a Vite dev server (prod, tests) or for a lazy resource
  // that should just be reused across module re-evaluations.
  hot: HotContext | undefined;
  // A hung stop must not keep the replacement down forever.
  stopTimeoutMs?: number;
  // stop() runs un-awaited from dispose(), so its failures land here.
  onError?: (error: unknown) => void;
}

export interface HotSingleton<T> {
  start(): Promise<T>;
  stop(): Promise<void>;
}

interface SingletonState {
  starting?: Promise<unknown>;
  stopping?: Promise<void>;
  started?: boolean;
}

const DEFAULT_STOP_TIMEOUT_MS = 15_000;

// The registry lives on globalThis so the state outlives the module that gets
// replaced on hot update.
const globalWithRegistry: typeof globalThis & {
  __everrHotSingletons?: Map<string, SingletonState>;
} = globalThis;
globalWithRegistry.__everrHotSingletons ??= new Map();
const registry = globalWithRegistry.__everrHotSingletons;

// Resolve once the promise settles, or after `ms`, whichever comes first.
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function hotSingleton<T>(options: HotSingletonOptions<T>): HotSingleton<T> {
  const {
    key,
    start: startResource,
    stop: stopResource,
    hot,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    onError,
  } = options;

  const state = registry.get(key) ?? {};
  registry.set(key, state);

  async function start(): Promise<T> {
    state.started = true;
    state.starting ??= (async () => {
      // A replacement must wait for the previous instance to stop; two live
      // instances would both act on the same shared resource.
      if (state.stopping) {
        await settleWithin(state.stopping, stopTimeoutMs);
        state.stopping = undefined;
      }
      return startResource();
    })();
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the shared registry stores SingletonState.starting as Promise<unknown> across singletons of differing T; startResource() resolves to T by construction.
    return state.starting as Promise<T>;
  }

  async function stop(): Promise<void> {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the shared registry stores SingletonState.starting as Promise<unknown> across singletons of differing T; startResource() resolves to T by construction.
    const starting = state.starting as Promise<T> | undefined;
    state.starting = undefined;
    if (!starting) return;

    state.stopping = starting
      .then(
        (value) => stopResource(value),
        () => {
          // start() failed; there is nothing to tear down.
        },
      )
      .catch((error) => {
        onError?.(error);
      });
    await state.stopping;
  }

  if (hot) {
    hot.dispose(() => {
      // Vite does not await dispose; the next start() drains state.stopping
      // before creating the replacement, so the un-awaited stop is safe.
      void stop();
    });
    // Self-accept so edits anywhere under this module's graph tear down the old
    // resource immediately instead of leaving it live until the next import.
    hot.accept();
    if (state.started) {
      // The module was re-evaluated after a prior run: restart. start() drains
      // any in-flight stop first, so order vs. the old module's dispose is moot.
      void start();
    }
  }

  return { start, stop };
}
