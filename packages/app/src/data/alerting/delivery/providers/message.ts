import { truncateWithEllipsis } from "@/lib/truncate";

export interface ChannelNotification {
  title: string;
  body: string;
  url?: string;
}

/**
 * Fit a notification into one channel's text limit.
 *
 * The url is the pointer to the alert page and the highest-value token in the
 * message. When a channel limit forces a cut, the body gives way and the url
 * survives whole; only a title and url that alone exceed the limit fall back
 * to a blind cut.
 */
export function composeText(
  notification: ChannelNotification,
  max: number,
): string {
  const url = notification.url ?? "";
  const frameLength = url
    ? notification.title.length + url.length + 4
    : notification.title.length + 2;
  const bodyBudget = max - frameLength;
  if (bodyBudget <= 0) {
    return truncateWithEllipsis(
      [notification.title, url].filter(Boolean).join("\n\n"),
      max,
    );
  }
  return [
    notification.title,
    truncateWithEllipsis(notification.body, bodyBudget),
    url,
  ]
    .filter(Boolean)
    .join("\n\n");
}
