import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import { webhookHeaderProblem } from "../webhook-headers";
import type { ChannelNotification } from "./message";
import { ChannelSendError, postJson } from "./outbound";

/**
 * The generic channel: the notification's own shape is the payload, because
 * the receiver is someone else's endpoint and we have no schema to target.
 * Unlike the branded channels, nothing here is composed to a text limit; a
 * caller's own service decides what to do with the fields.
 */
function requestHeaders(headers: { name: string; value: string }[] | undefined): Headers {
  const request = new Headers();
  for (const header of headers ?? []) {
    // A saved config is checked again here. The message names the header and
    // never its value: this text can land in the delivery trail.
    const problem = webhookHeaderProblem(header);
    if (problem) {
      throw new ChannelSendError(problem, { permanent: true });
    }
    try {
      request.append(header.name, header.value);
    } catch {
      throw new ChannelSendError(`header ${header.name} cannot be set`, {
        permanent: true,
      });
    }
  }
  return request;
}

export function sendWebhookNotification(
  config: Extract<AlertingChannelConfig, { type: "webhook" }>,
  notification: ChannelNotification,
): Promise<void> {
  return postJson(config.url, notification, requestHeaders(config.headers));
}
