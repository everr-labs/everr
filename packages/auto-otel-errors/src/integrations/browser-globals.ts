import type { Integration } from "../types.js";

export function browserGlobalHandlersIntegration(): Integration {
  let onError: ((event: globalThis.ErrorEvent) => void) | null = null;
  let onRejection: ((event: Event) => void) | null = null;

  return {
    name: "browserGlobalHandlers",
    setup(client) {
      onError = (event) => {
        if (!event.error) {
          return;
        }

        client.capture({
          error: event.error,
          mechanism: "onerror",
          handled: false,
        });
      };
      onRejection = (event) => {
        const reason = (event as { reason?: unknown }).reason;
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
