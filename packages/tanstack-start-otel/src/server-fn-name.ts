import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Bridges the server-function middleware back to the transport wrapper: the
 * wrapper only sees the opaque `/_serverFn/<id>` path, while the middleware
 * holds the function's name. The wrapper runs the handler inside a mutable
 * holder, the middleware fills it, and the wrapper reads it after the
 * response to rename its span and the `x-everr-route` echo to
 * `/_serverFn/{name}`.
 *
 * App-owned AsyncLocalStorage rather than the OTel context: the OTel context
 * manager is only registered once the NodeSDK boots, and this bridge must not
 * depend on that ordering.
 */
export type ServerFunctionName = { name?: string };

const storage = new AsyncLocalStorage<ServerFunctionName>();

export function runWithServerFunctionName<T>(
  holder: ServerFunctionName,
  run: () => T,
): T {
  return storage.run(holder, run);
}

export function recordServerFunctionName(name: string): void {
  const holder = storage.getStore();
  if (holder) holder.name = name;
}
