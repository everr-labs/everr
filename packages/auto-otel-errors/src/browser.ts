import { Client, type Runtime } from "./client.js";
import { initClient } from "./core.js";
import { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
import type { Integration, Options } from "./types.js";

export { Client };
export type { Runtime };
export { captureError, getClient, teardown } from "./core.js";
export type { CaptureErrorOptions } from "./core.js";
export { browserApiErrorsIntegration } from "./integrations/browser-api-errors.js";
export { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
export type { ErrorEvent, Integration, Mechanism, Options } from "./types.js";

// `browserApiErrors` patches setTimeout/setInterval/requestAnimationFrame/
// addEventListener globally, so it is opt-in rather than a default. Add it
// explicitly when capturing third-party script errors matters:
//   init({ integrations: [...browserDefaultIntegrations(), browserApiErrorsIntegration()] })
export function browserDefaultIntegrations(): Integration[] {
  return [browserGlobalHandlersIntegration()];
}

export function init(options: Options = {}): Client {
  return initClient(options, "browser", browserDefaultIntegrations());
}
