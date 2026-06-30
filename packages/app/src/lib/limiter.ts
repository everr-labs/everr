/**
 * Bounds how many async tasks run concurrently. Calls beyond `maxConcurrent`
 * queue (FIFO) and start as running tasks finish — so a burst of work (e.g. a
 * dashboard's panels all becoming visible at once) is spread into waves instead
 * of hitting the backend simultaneously.
 *
 * Each call may pass an `AbortSignal`; a task already aborted by the time its
 * turn comes is skipped (it rejects without running its work), which lets
 * react-query treat it as a cancellation rather than firing a useless request.
 */
export function createLimiter(maxConcurrent: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  function release() {
    const next = waiters.shift();
    // Hand the freed slot straight to the next waiter (active stays at the cap);
    // only drop the count when nobody is waiting.
    if (next) next();
    else active--;
  }

  return async function run<T>(
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active++;
    }
    try {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      return await task();
    } finally {
      release();
    }
  };
}
