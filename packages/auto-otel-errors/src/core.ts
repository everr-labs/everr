import { type Attributes, diag } from "@opentelemetry/api";
import { Client, PKG_NAME, type Runtime } from "./client.js";
import type { BreadcrumbInput, Integration, Options } from "./types.js";

let activeClient: Client | null = null;

export function initClient(
  options: Options,
  runtime: Runtime,
  defaultIntegrations: Integration[],
): Client {
  if (activeClient) {
    diag.warn(`${PKG_NAME}: init() called twice; returning the existing client`);
    return activeClient;
  }

  const integrations = options.integrations ?? defaultIntegrations;
  const client = new Client(options, runtime, integrations);
  client.setup();
  activeClient = client;
  return client;
}

export function getClient(): Client | null {
  return activeClient;
}

export function captureError(error: unknown, attributes?: Attributes): void {
  activeClient?.capture({ error, mechanism: "manual", handled: true, attributes });
}

export function addBreadcrumb(crumb: BreadcrumbInput): void {
  activeClient?.addBreadcrumb(crumb);
}

export function teardown(): void {
  activeClient?.teardown();
  activeClient = null;
}
