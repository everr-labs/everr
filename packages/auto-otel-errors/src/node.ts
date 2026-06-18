import { Client, type Runtime } from "./client.js";
import { initClient } from "./core.js";
import { nodeGlobalHandlersIntegration } from "./integrations/node-globals.js";
import type { Integration, Options } from "./types.js";

export { Client };
export type { Runtime };
export { captureError, getClient, teardown } from "./core.js";
export type { CaptureErrorOptions } from "./core.js";
export { nodeGlobalHandlersIntegration } from "./integrations/node-globals.js";
export type { ErrorEvent, Integration, Mechanism, Options } from "./types.js";

export function nodeDefaultIntegrations(): Integration[] {
  return [nodeGlobalHandlersIntegration()];
}

export function init(options: Options = {}): Client {
  return initClient(options, "node", nodeDefaultIntegrations());
}
