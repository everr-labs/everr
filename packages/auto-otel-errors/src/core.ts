import { type Attributes, diag } from "@opentelemetry/api";
import { Client, PKG_NAME, type Runtime } from "./client.js";
import type { Integration, Options } from "./types.js";

let activeClient: Client | null = null;

export interface CaptureErrorOptions {
  handled?: boolean;
}

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

export function captureError(
  error: unknown,
  attributes?: Attributes,
  options?: CaptureErrorOptions,
): void {
  const handledAttr = attributes?.["error.handled"];
  const handled =
    options?.handled ?? (typeof handledAttr === "boolean" ? handledAttr : true);

  if (!activeClient) {
    diag.warn(`${PKG_NAME}: captureError called before init(); error dropped`);
    return;
  }

  activeClient.capture({ error, mechanism: "manual", handled, attributes });
}

export function teardown(): void {
  activeClient?.teardown();
  activeClient = null;
}
