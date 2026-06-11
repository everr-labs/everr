import diagnosticsChannel from "node:diagnostics_channel";
import type { Integration } from "../types.js";
import {
  reportNetworkFailure,
  reportResponse,
  resolveNetworkConfig,
} from "./network-shared.js";

interface UndiciRequest {
  origin?: string | URL;
  path?: string;
  method?: string;
}

type Subscription = {
  name: string;
  handler: diagnosticsChannel.ChannelListener;
};

export function nodeNetworkIntegration(): Integration {
  let subscriptions: Subscription[] = [];

  return {
    name: "nodeNetwork",
    setup(client) {
      const config = resolveNetworkConfig(client);
      if (!config.enabled && !config.breadcrumbs) {
        return;
      }

      const starts = new WeakMap<object, number>();
      const subscribe = (
        name: string,
        handler: diagnosticsChannel.ChannelListener,
      ) => {
        diagnosticsChannel.subscribe(name, handler);
        subscriptions.push({ name, handler });
      };

      subscribe("undici:request:create", (message) => {
        const { request } = message as { request: UndiciRequest & object };
        starts.set(request, Date.now());
      });

      subscribe("undici:request:headers", (message) => {
        const { request, response } = message as {
          request: UndiciRequest & object;
          response: { statusCode: number };
        };
        const started = starts.get(request);
        reportResponse(client, config, {
          method: request.method ?? "GET",
          url: requestUrl(request),
          mechanism: "fetch",
          status: response.statusCode,
          ...(started !== undefined ? { durationMs: Date.now() - started } : {}),
        });
      });

      subscribe("undici:request:error", (message) => {
        const { request, error } = message as {
          request: UndiciRequest;
          error: unknown;
        };
        reportNetworkFailure(client, config, {
          method: request.method ?? "GET",
          url: requestUrl(request),
          mechanism: "fetch",
          error,
        });
      });
    },
    teardown() {
      for (const { name, handler } of subscriptions) {
        diagnosticsChannel.unsubscribe(name, handler);
      }
      subscriptions = [];
    },
  };
}

function requestUrl(request: UndiciRequest): string {
  return `${String(request.origin ?? "")}${request.path ?? ""}`;
}
