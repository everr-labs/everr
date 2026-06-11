import type { Integration } from "../types.js";
import {
  reportNetworkFailure,
  reportResponse,
  resolveNetworkConfig,
} from "./network-shared.js";

interface XhrMeta {
  method: string;
  url: string;
  started: number;
}

const XHR_META = Symbol("everr-auto-otel-errors-xhr");

type XhrWithMeta = XMLHttpRequest & { [XHR_META]?: XhrMeta };

export function browserNetworkIntegration(): Integration {
  let originalFetch: typeof globalThis.fetch | null = null;
  let originalOpen: typeof XMLHttpRequest.prototype.open | null = null;
  let originalSend: typeof XMLHttpRequest.prototype.send | null = null;

  return {
    name: "browserNetwork",
    setup(client) {
      const config = resolveNetworkConfig(client);
      if (!config.enabled && !config.breadcrumbs) {
        return;
      }

      if (typeof globalThis.fetch === "function") {
        originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const method = (
            init?.method ??
            (typeof Request !== "undefined" && input instanceof Request
              ? input.method
              : "GET")
          ).toUpperCase();
          const url =
            typeof Request !== "undefined" && input instanceof Request
              ? input.url
              : String(input);
          const started = Date.now();

          try {
            const response = await originalFetch!(input, init);
            reportResponse(client, config, {
              method,
              url,
              mechanism: "fetch",
              status: response.status,
              durationMs: Date.now() - started,
            });
            return response;
          } catch (error) {
            reportNetworkFailure(client, config, {
              method,
              url,
              mechanism: "fetch",
              error,
            });
            throw error;
          }
        };
      }

      if (typeof XMLHttpRequest !== "undefined") {
        originalOpen = XMLHttpRequest.prototype.open;
        originalSend = XMLHttpRequest.prototype.send;

        const patchedOpen = function (
          this: XhrWithMeta,
          ...args:
            | [method: string, url: string | URL]
            | [
                method: string,
                url: string | URL,
                async: boolean,
                username?: string | null,
                password?: string | null,
              ]
        ) {
          this[XHR_META] = {
            method: String(args[0]).toUpperCase(),
            url: String(args[1]),
            started: 0,
          };
          return args.length === 2
            ? originalOpen!.call(this, args[0], args[1], true)
            : originalOpen!.call(this, args[0], args[1], args[2], args[3], args[4]);
        } as typeof XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = patchedOpen;

        XMLHttpRequest.prototype.send = function (
          this: XhrWithMeta,
          ...args: Parameters<typeof XMLHttpRequest.prototype.send>
        ) {
          const meta = this[XHR_META];
          if (meta) {
            meta.started = Date.now();
            this.addEventListener("loadend", () => {
              if (this.status === 0) {
                const error = new Error(
                  `Network request failed: ${meta.method} ${meta.url}`,
                );
                error.name = "NetworkError";
                reportNetworkFailure(client, config, {
                  method: meta.method,
                  url: meta.url,
                  mechanism: "xhr",
                  error,
                });
              } else {
                reportResponse(client, config, {
                  method: meta.method,
                  url: meta.url,
                  mechanism: "xhr",
                  status: this.status,
                  durationMs: Date.now() - meta.started,
                });
              }
            });
          }

          return originalSend!.apply(this, args);
        };
      }
    },
    teardown() {
      if (originalFetch) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
      }
      if (originalOpen) {
        XMLHttpRequest.prototype.open = originalOpen;
        originalOpen = null;
      }
      if (originalSend) {
        XMLHttpRequest.prototype.send = originalSend;
        originalSend = null;
      }
    },
  };
}
