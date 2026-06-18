import { Client, type Runtime } from "./client.js";
import { initClient } from "./core.js";
import { browserApiErrorsIntegration } from "./integrations/browser-api-errors.js";
import { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
import type { Integration, Options } from "./types.js";

export { Client };
export type { Runtime };
export { captureError, getClient, teardown } from "./core.js";
export type { CaptureErrorOptions } from "./core.js";
export { browserApiErrorsIntegration } from "./integrations/browser-api-errors.js";
export { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
export type { ErrorEvent, Integration, Mechanism, Options } from "./types.js";

export function browserDefaultIntegrations(): Integration[] {
  return [browserGlobalHandlersIntegration(), browserApiErrorsIntegration()];
}

export function init(options: Options = {}): Client {
  return initClient(options, "browser", browserDefaultIntegrations());
}
