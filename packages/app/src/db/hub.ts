import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";
import { NotificationHub } from "./notification-hub";
import type { NotifyPayload } from "./notify";

const hub = new NotificationHub();

let started = false;

function ensureStarted(): void {
  if (!started) {
    started = true;
    hub.start().catch((err) => {
      started = false;
      serverLogger.error("notification_hub.start.failed", exceptionAttributes(err));
    });
  }
}

type Callback = (payload: NotifyPayload) => void;

export function subscribeTenant(tenantId: string, callback: Callback): () => void {
  ensureStarted();
  return hub.subscribe("tenant", tenantId, callback);
}

export function subscribeTrace(tenantId: string, traceId: string, callback: Callback): () => void {
  ensureStarted();
  return hub.subscribe("trace", `${tenantId}:${traceId}`, callback);
}
