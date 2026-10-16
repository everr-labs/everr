import { internalIngestHeaders } from "@app/ingestion";
import { requireGithubConfiguration } from "@/integrations/github/configuration";
import { retentionForOrg } from "@/product/retention.server";
import { GH_EVENTS_CONFIG } from "./config";
import { recordToHeaders, stripHopByHopHeaders } from "./headers";
import type { WebhookHeaders } from "./types";
import { TerminalEventError } from "./types";

// The collector's internal pipeline copies these into resource attributes
// (collector/config.example.yml, processor `resource`); the views stamp
// retention_days from them and strip them before storage.
const retentionHeaderNames = {
  logsDays: "x-everr-retention-logs-days",
  tracesDays: "x-everr-retention-traces-days",
  metricsDays: "x-everr-retention-metrics-days",
} as const;

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
  event: { headers: WebhookHeaders; body: Buffer },
  organizationId: string,
): Promise<void> {
  const headers = recordToHeaders(event.headers);
  stripHopByHopHeaders(headers);
  for (const [name, value] of Object.entries(
    internalIngestHeaders(organizationId),
  )) {
    headers.set(name, value);
  }
  const retention = await retentionForOrg(organizationId);
  headers.set(retentionHeaderNames.logsDays, String(retention.logsDays));
  headers.set(retentionHeaderNames.tracesDays, String(retention.tracesDays));
  headers.set(retentionHeaderNames.metricsDays, String(retention.metricsDays));

  const response = await fetch(
    requireGithubConfiguration().INGRESS_COLLECTOR_URL,
    {
      method: "POST",
      headers,
      body: new Uint8Array(event.body),
      signal: AbortSignal.timeout(GH_EVENTS_CONFIG.replayTimeoutMs),
    },
  );

  if (response.ok) {
    return;
  }

  const bodyText = await response.text();
  classifyFailedResponse("collector", response.status, bodyText);
}
