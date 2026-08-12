export interface Flushable {
  forceFlush(): Promise<void>;
}

/**
 * The SDK provider has the `forceFlush` function, but the API gives proxies.
 * The `trace.getTracerProvider()` function always returns a
 * ProxyTracerProvider. The `logs.getLoggerProvider()` function returns a
 * ProxyLoggerProvider until an SDK registers. Each proxy keeps the true
 * provider behind a delegate getter.
 *
 * The loop stops at a provider that it saw before. A proxy with no delegate
 * gives the provider that does nothing, or it gives itself, and a chain of
 * delegates can also return to its start. The caller operates on the fatal
 * path, and thus this code must always stop.
 */
export function resolveFlushable(candidate: unknown): Flushable | null {
  const seen = new Set<unknown>();
  let current = candidate;

  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);

    const provider = current as Partial<Flushable> & {
      getDelegate?: () => unknown;
      _getDelegate?: () => unknown;
    };

    if (typeof provider.forceFlush === "function") {
      return provider as Flushable;
    }

    const delegate = provider.getDelegate ?? provider._getDelegate;
    if (typeof delegate !== "function") {
      return null;
    }

    current = delegate.call(provider);
  }

  return null;
}
