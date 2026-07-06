import { z } from "zod";
import { ccRequest } from "@/lib/clickety-clack.server";
import {
  CcAlertSchema,
  CcDeletedSchema,
  CcInhibitionSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleSchema,
  CcRuleSpecSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSubscriptionSchema,
  CcTestResultSchema,
} from "./schema";
import type { CcMatcher, CcRuleSpec } from "./types";

// ---- Rules ----
export async function listRules(orgId: string) {
  return z
    .array(CcRuleViewSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/rules"));
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

// ---- Receivers ----
export async function listReceivers(orgId: string) {
  return z
    .array(CcReceiverSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/receivers"));
}
export async function upsertReceiver(
  orgId: string,
  body: { name: string; channel: unknown },
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
export type RouteInput = {
  matchers: CcMatcher[];
  receiver: string;
  continue: boolean;
  priority: number;
  group_by: string[] | null;
  group_wait_secs: number | null;
  group_interval_secs: number | null;
  repeat_interval_secs: number | null;
};
export async function listRoutes(orgId: string) {
  return z
    .array(CcRouteSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/routes"));
}
export async function createRoute(orgId: string, input: RouteInput) {
  return CcRouteSchema.parse(
    await ccRequest(orgId, "POST", "/v1/routes", input),
  );
}
/** Full-body replace of an existing route (same shape as create). */
export async function updateRoute(
  orgId: string,
  id: string,
  input: RouteInput,
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
export type InhibitionInput = {
  source_matchers: CcMatcher[];
  target_matchers: CcMatcher[];
  equal: string[];
};
export async function listInhibitions(orgId: string) {
  return z
    .array(CcInhibitionSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/inhibitions"));
}
export async function createInhibition(orgId: string, input: InhibitionInput) {
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
export type SilenceInput = {
  matchers: CcMatcher[];
  starts_at: string;
  ends_at: string;
  comment?: string;
  author?: string;
};
export async function listSilences(orgId: string) {
  return z
    .array(CcSilenceSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/silences"));
}
export async function createSilence(orgId: string, input: SilenceInput) {
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
