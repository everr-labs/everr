export interface Flushable {
  forceFlush(): Promise<void>;
}

/**
 * The SDK provider has the `forceFlush` function, but the API gives proxies.
 * The `trace.getTracerProvider()` function always returns a
 * ProxyTracerProvider. The `logs.getLoggerProvider()` function returns a
 * ProxyLoggerProvider until an SDK registers. Each proxy keeps the true
 * provider behind a delegate getter.
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
    // If a proxy has no delegate, it returns the provider that does nothing.
    // That provider has no forceFlush function. Thus this loop stops.
    return inner === candidate ? null : resolveFlushable(inner);
  }

  return null;
}
