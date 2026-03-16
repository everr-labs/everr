import { env } from "@/env";
import { GH_EVENTS_CONFIG } from "./config";
import { recordToHeaders, stripHopByHopHeaders } from "./headers";
import type { WebhookEventRecord } from "./types";
import { TerminalEventError } from "./types";

export const tenantHeaderName = "x-everr-tenant-id";

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function classifyFailedResponse(
  target: string,
  status: number,
  bodyText: string,
): never {
  const message = `${target} status=${status} body=${JSON.stringify(bodyText)}`;
  if (isRetryableStatus(status)) {
    throw new Error(message);
  }

  throw new TerminalEventError(message);
}

export async function replayWebhookToCollector(
  event: WebhookEventRecord,
  tenantId: number,
): Promise<void> {
  const headers = recordToHeaders(event.headers);
  stripHopByHopHeaders(headers);
  headers.set(tenantHeaderName, String(tenantId));

  const response = await fetch(env.INGRESS_COLLECTOR_URL, {
    method: "POST",
    headers,
    body: new Uint8Array(event.body),
    signal: AbortSignal.timeout(GH_EVENTS_CONFIG.replayTimeoutMs),
  });

  if (response.ok) {
    return;
  }

  const bodyText = await response.text();
  classifyFailedResponse("collector", response.status, bodyText);
}
