import type { Integration } from "../types.js";

export function browserGlobalHandlersIntegration(): Integration {
  let onError: ((event: globalThis.ErrorEvent) => void) | null = null;
  let onRejection: ((event: PromiseRejectionEvent) => void) | null = null;

  return {
    name: "browserGlobalHandlers",
    setup(client) {
      onError = (event) => {
        // Skip errors browserApiErrors already captured before re-throwing.
        if (!event.error || client.wasCaptured(event.error)) {
          return;
        }

        client.capture({
          error: event.error,
          mechanism: "onerror",
          handled: false,
        });
      };
      onRejection = (event) => {
        const reason: unknown = event.reason;
        if (client.wasCaptured(reason)) {
          return;
        }

        client.capture({
          error: reason,
          mechanism: "unhandledrejection",
          handled: false,
        });
      };

      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
    },
    teardown() {
      if (onError) {
        window.removeEventListener("error", onError);
      }
      if (onRejection) {
        window.removeEventListener("unhandledrejection", onRejection);
      }
      onError = null;
      onRejection = null;
    },
  };
}
