import { NotificationHub, type Topic } from "./notification-hub";
import type { NotifyPayload } from "./notify";

const hub = new NotificationHub();

let started = false;

function ensureStarted(): void {
  if (!started) {
    started = true;
    hub.start().catch((err) => {
      started = false;
      console.error("[NotificationHub] failed to start", err);
    });
  }
}

type Callback = (payload: NotifyPayload) => void;

export function subscribeTenant(
  tenantId: string,
  callback: Callback,
): () => void {
  ensureStarted();
  return hub.subscribe("tenant", tenantId, callback);
}

export function subscribe(
  topic: Exclude<Topic, "tenant">,
  tenantId: string,
  id: string,
  callback: Callback,
): () => void {
  ensureStarted();
  return hub.subscribe(topic, `${tenantId}:${id}`, callback);
}

export function subscribeAuthor(
  tenantId: string,
  email: string,
  callback: Callback,
): () => void {
  ensureStarted();
  return hub.subscribe(
    "author",
    `${tenantId}:${email.toLowerCase()}`,
    callback,
  );
}

export function shutdownHub(): void {
  hub.shutdown();
  started = false;
}
