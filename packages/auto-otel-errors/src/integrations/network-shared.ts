import type { Client } from "../client.js";
import type { Mechanism } from "../types.js";

export interface NetworkConfig {
  enabled: boolean;
  breadcrumbs: boolean;
  captureStatus: (code: number) => boolean;
  isIgnored: (url: string) => boolean;
}

export function resolveNetworkConfig(client: Client): NetworkConfig {
  const network = client.options.network;
  const ignore = network === false ? [] : (network?.ignoreUrls ?? []);

  return {
    enabled: network !== false,
    breadcrumbs: client.breadcrumbsEnabledFor("network"),
    captureStatus:
      network === false
        ? () => false
        : (network?.captureStatusCodes ?? ((code: number) => code >= 500)),
    isIgnored: (url: string) =>
      ignore.some((pattern) =>
        typeof pattern === "string" ? url.includes(pattern) : pattern.test(url),
      ),
  };
}

export interface NetworkRequestInfo {
  method: string;
  url: string;
  mechanism: Extract<Mechanism, "fetch" | "xhr">;
}

export function reportResponse(
  client: Client,
  config: NetworkConfig,
  info: NetworkRequestInfo & { status: number; durationMs?: number },
): void {
  if (config.isIgnored(info.url)) {
    return;
  }

  if (config.breadcrumbs) {
    client.addBreadcrumb({
      category: "http",
      message: `${info.method} ${info.url} ${info.status}`,
      level: info.status >= 500 ? "error" : "info",
      data: {
        "http.response.status_code": info.status,
        ...(info.durationMs !== undefined
          ? { "http.request.duration_ms": info.durationMs }
          : {}),
      },
    });
  }

  if (config.captureStatus(info.status)) {
    const error = new Error(`HTTP ${info.status} from ${info.method} ${info.url}`);
    error.name = "HttpServerError";
    client.capture({
      error,
      mechanism: info.mechanism,
      handled: true,
      attributes: {
        "http.request.method": info.method,
        "url.full": info.url,
        "http.response.status_code": info.status,
      },
    });
  }
}

export function reportNetworkFailure(
  client: Client,
  config: NetworkConfig,
  info: NetworkRequestInfo & { error: unknown },
): void {
  if (config.isIgnored(info.url)) {
    return;
  }

  if (config.breadcrumbs) {
    client.addBreadcrumb({
      category: "http",
      message: `${info.method} ${info.url} failed`,
      level: "error",
    });
  }

  client.capture({
    error: info.error,
    mechanism: info.mechanism,
    handled: true,
    attributes: {
      "http.request.method": info.method,
      "url.full": info.url,
    },
  });
}
