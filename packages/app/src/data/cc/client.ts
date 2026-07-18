import { z } from "zod";
import { ccRequest } from "@/lib/clickety-clack.server";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcDeletedSchema,
  CcInhibitionSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSubscriptionSchema,
  CcTestResultSchema,
} from "./schema";
import type {
  CcChannelConfig,
  CcInhibitionInput,
  CcRouteInput,
  CcRuleHealthStatus,
  CcRuleSpec,
  CcSilenceInput,
} from "./types";

// ---- Rules ----
export async function listRules(orgId: string) {
  return z
    .array(CcRuleViewSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/rules"));
}
/**
 * Paginated listing: sending `limit` (1..=500, CC defaults 100) opts into the
 * `{items, next_cursor}` envelope; `cursor` resumes from a previous page's
 * `next_cursor`. `health` filters server-side by evaluation health. The bare
 * `listRules` above keeps the legacy unbounded-array shape for its callers.
 */
export async function listRulesPage(
  orgId: string,
  opts: {
    limit?: number;
    cursor?: string;
    health?: CcRuleHealthStatus;
  } = {},
) {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 100) });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.health) params.set("health", opts.health);
  return CcRulesPageSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules?${params.toString()}`),
  );
}
export async function getRule(orgId: string, id: string) {
  return CcRuleViewSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules/${id}`),
  );
}
export async function createRule(orgId: string, spec: CcRuleSpec) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", "/v1/rules", CcRuleSpecSchema.parse(spec)),
  );
}
/**
 * In-place update: full spec (same shape as create) plus an optional `version`
 * for optimistic concurrency. On a stale version CC answers 409 conflict (a
 * `CcApiError` with status 409) and writes nothing; omitting `version` is
 * last-write-wins. Preserves the rule id, tenant, paused flag, and instance
 * state (instances are cleared only when the label_columns set changes).
 */
export async function updateRule(
  orgId: string,
  id: string,
  spec: CcRuleSpec,
  version?: number,
) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/rules/${id}`, {
      ...CcRuleSpecSchema.parse(spec),
      ...(version === undefined ? {} : { version }),
    }),
  );
}
export async function deleteRule(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/rules/${id}`),
  );
}
export async function pauseRule(orgId: string, id: string) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", `/v1/rules/${id}/pause`),
  );
}
export async function resumeRule(orgId: string, id: string) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", `/v1/rules/${id}/resume`),
  );
}
/** Ad-hoc evaluation. CC's test endpoint takes a full spec body. */
export async function testRule(orgId: string, id: string, spec: CcRuleSpec) {
  return CcTestResultSchema.parse(
    await ccRequest(
      orgId,
      "POST",
      `/v1/rules/${id}/test`,
      CcRuleSpecSchema.parse(spec),
    ),
  );
}

// ---- Alerts ----
export async function listAlerts(orgId: string) {
  return z
    .array(CcAlertSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/alerts"));
}

// ---- Channels ----
export async function listChannels(orgId: string) {
  return z
    .array(CcChannelSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/channels"));
}
/** CC's POST /v1/channels is an upsert by name (also the secret-rotation path). */
export async function upsertChannel(
  orgId: string,
  body: { name: string; config: CcChannelConfig },
) {
  return CcChannelSchema.parse(
    await ccRequest(orgId, "POST", "/v1/channels", body),
  );
}
/** CC answers 409 (CcApiError naming the referring receivers) while referenced. */
export async function deleteChannel(orgId: string, name: string) {
  return CcDeletedSchema.parse(
    await ccRequest(
      orgId,
      "DELETE",
      `/v1/channels/${encodeURIComponent(name)}`,
    ),
  );
}

// ---- Receivers ----
export async function listReceivers(orgId: string) {
  return z
    .array(CcReceiverSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/receivers"));
}
export async function upsertReceiver(
  orgId: string,
  body: { name: string; channels: string[] },
) {
  return CcReceiverSchema.parse(
    await ccRequest(orgId, "POST", "/v1/receivers", body),
  );
}
export async function deleteReceiver(orgId: string, name: string) {
  return CcDeletedSchema.parse(
    await ccRequest(
      orgId,
      "DELETE",
      `/v1/receivers/${encodeURIComponent(name)}`,
    ),
  );
}

// ---- Routes ----
export async function listRoutes(orgId: string) {
  return z
    .array(CcRouteSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/routes"));
}
export async function createRoute(orgId: string, input: CcRouteInput) {
  return CcRouteSchema.parse(
    await ccRequest(orgId, "POST", "/v1/routes", input),
  );
}
/** Full-body replace of an existing route (same shape as create). */
export async function updateRoute(
  orgId: string,
  id: string,
  input: CcRouteInput,
) {
  return CcRouteSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/routes/${id}`, input),
  );
}
export async function deleteRoute(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/routes/${id}`),
  );
}

// ---- Inhibitions ----
export async function listInhibitions(orgId: string) {
  return z
    .array(CcInhibitionSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/inhibitions"));
}
export async function createInhibition(
  orgId: string,
  input: CcInhibitionInput,
) {
  return CcInhibitionSchema.parse(
    await ccRequest(orgId, "POST", "/v1/inhibitions", input),
  );
}
export async function deleteInhibition(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/inhibitions/${id}`),
  );
}

// ---- Silences ----
export async function listSilences(orgId: string) {
  return z
    .array(CcSilenceSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/silences"));
}
export async function createSilence(orgId: string, input: CcSilenceInput) {
  return CcSilenceSchema.parse(
    await ccRequest(orgId, "POST", "/v1/silences", input),
  );
}
export async function deleteSilence(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/silences/${id}`),
  );
}

// ---- Subscriptions ----
export async function listSubscriptions(orgId: string) {
  return z
    .array(CcSubscriptionSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/subscriptions"));
}
export async function createSubscription(orgId: string, webhookUrl: string) {
  return CcSubscriptionSchema.parse(
    await ccRequest(orgId, "POST", "/v1/subscriptions", {
      webhook_url: webhookUrl,
    }),
  );
}
export async function deleteSubscription(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/subscriptions/${id}`),
  );
}
