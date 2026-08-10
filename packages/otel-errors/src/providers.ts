export interface Flushable {
  forceFlush(): Promise<void>;
}

/**
 * `forceFlush` lives on the SDK provider, but the API hands out proxies:
 * `trace.getTracerProvider()` always returns a ProxyTracerProvider, and
 * `logs.getLoggerProvider()` returns a ProxyLoggerProvider until an SDK
 * registers. Both keep the real provider behind a delegate getter.
 */
export function resolveFlushable(candidate: unknown): Flushable | null {
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  const provider = candidate as Partial<Flushable> & {
    getDelegate?: () => unknown;
    _getDelegate?: () => unknown;
  };

  if (typeof provider.forceFlush === "function") {
    return provider as Flushable;
  }

  const delegate = provider.getDelegate ?? provider._getDelegate;
  if (typeof delegate === "function") {
    const inner = delegate.call(provider);
    // A proxy whose delegate is unset returns the noop provider, which has no
    // forceFlush, so this terminates.
    return inner === candidate ? null : resolveFlushable(inner);
  }

  return null;
}
