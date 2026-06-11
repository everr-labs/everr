import { Client, type Runtime } from "./client.js";
import { initClient } from "./core.js";
import { browserDomIntegration } from "./integrations/browser-dom.js";
import { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
import { browserNetworkIntegration } from "./integrations/browser-network.js";
import { consoleIntegration } from "./integrations/console.js";
import type { Integration, Options } from "./types.js";

export { Client };
export type { Runtime };
export { addBreadcrumb, captureError, getClient, teardown } from "./core.js";
export { browserDomIntegration } from "./integrations/browser-dom.js";
export { browserGlobalHandlersIntegration } from "./integrations/browser-globals.js";
export { browserNetworkIntegration } from "./integrations/browser-network.js";
export { consoleIntegration } from "./integrations/console.js";
export type {
  Breadcrumb,
  BreadcrumbInput,
  ConsoleLevel,
  ErrorEvent,
  Integration,
  Mechanism,
  Options,
} from "./types.js";

export function browserDefaultIntegrations(): Integration[] {
  return [
    browserGlobalHandlersIntegration(),
    consoleIntegration(),
    browserNetworkIntegration(),
    browserDomIntegration(),
  ];
}

export function init(options: Options = {}): Client {
  return initClient(options, "browser", browserDefaultIntegrations());
}
