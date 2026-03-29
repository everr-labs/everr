import { NotificationHub, type Topic } from "./notification-hub";
import type { NotifyPayload } from "./notify";

const hub = new NotificationHub();

let started = false;

function ensureStarted(): void {
  if (!started) {
    started = true;
    hub.start().catch((err) => {
      console.error("[NotificationHub] failed to start", err);
    });
  }
}

type Callback = (payload: NotifyPayload) => void;

export function subscribeTenant(
  tenantId: number,
  callback: Callback,
): () => void {
  ensureStarted();
  return hub.subscribe("tenant", String(tenantId), callback);
}

export function subscribe(
  topic: Exclude<Topic, "tenant">,
  tenantId: number,
  id: string,
  callback: Callback,
): () => void {
  ensureStarted();
  return hub.subscribe(topic, `${tenantId}:${id}`, callback);
}

export function shutdownHub(): void {
  hub.shutdown();
  started = false;
}
