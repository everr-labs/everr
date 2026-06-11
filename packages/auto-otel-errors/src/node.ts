import { Client, type Runtime } from "./client.js";
import { initClient } from "./core.js";
import { consoleIntegration } from "./integrations/console.js";
import { nodeGlobalHandlersIntegration } from "./integrations/node-globals.js";
import { nodeNetworkIntegration } from "./integrations/node-network.js";
import type { Integration, Options } from "./types.js";

export { Client };
export type { Runtime };
export { addBreadcrumb, captureError, getClient, teardown } from "./core.js";
export { consoleIntegration } from "./integrations/console.js";
export { nodeGlobalHandlersIntegration } from "./integrations/node-globals.js";
export { nodeNetworkIntegration } from "./integrations/node-network.js";
export type {
  Breadcrumb,
  BreadcrumbInput,
  ConsoleLevel,
  ErrorEvent,
  Integration,
  Mechanism,
  Options,
} from "./types.js";

export function nodeDefaultIntegrations(): Integration[] {
  return [
    nodeGlobalHandlersIntegration(),
    consoleIntegration(),
    nodeNetworkIntegration(),
  ];
}

export function init(options: Options = {}): Client {
  return initClient(options, "node", nodeDefaultIntegrations());
}
