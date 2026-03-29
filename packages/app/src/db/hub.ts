import { NotificationHub } from "./notification-hub";

export type { Topic } from "./notification-hub";

const hub = new NotificationHub();

let started = false;

export function subscribe(
  ...args: Parameters<NotificationHub["subscribe"]>
): ReturnType<NotificationHub["subscribe"]> {
  if (!started) {
    started = true;
    hub.start().catch((err) => {
      console.error("[NotificationHub] failed to start", err);
    });
  }
  return hub.subscribe(...args);
}

export function shutdownHub(): void {
  hub.shutdown();
  started = false;
}
