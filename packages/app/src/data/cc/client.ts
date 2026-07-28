import { z } from "zod";
import { CcApiError, ccRequest } from "@/lib/clickety-clack.server";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcDeletedSchema,
  CcInhibitionSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleInputSchema,
  CcRuleSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSloInputSchema,
  CcSloSchema,
  CcSloStatusSchema,
  CcSloTestResultSchema,
  CcSloUpdateSchema,
  CcSloViewSchema,
  CcSubscriptionSchema,
  CcTestResultSchema,
} from "./schema";
import type {
  CcChannelConfig,
  CcInhibitionInput,
  CcRouteInput,
  CcRuleInput,
  CcRuleSpec,
  CcSilenceInput,
  CcSloInput,
  CcSloUpdate,
} from "./types";

// ---- Rules ----
/**
 * Paginated listing: sending `limit` (1..=500, CC defaults 100) opts into the
 * `{items, next_cursor}` envelope; `cursor` resumes from a previous page's
 * `next_cursor`. `namespace`/`name` filter by exact match on first-class
 * identity. This is
 * the only listing mode: GET /v1/rules without pagination (the legacy bare
 * array) is being removed from the CC API.
 */
export async function listRulesPage(
  orgId: string,
  opts: {
    limit?: number;
    cursor?: string;
    namespace?: string;
    name?: string;
  } = {},
) {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 100) });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.namespace !== undefined) params.set("namespace", opts.namespace);
  if (opts.name !== undefined) params.set("name", opts.name);
  return CcRulesPageSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules?${params.toString()}`),
  );
}
/**
 * Every rule, by walking {@link listRulesPage} until `next_cursor` runs out
 * (CC's page size, 500 max per request). For callers that genuinely need the
 * whole set in one shot — reconcilers, label suggestions, handle resolution —
 * now that the unpaginated GET /v1/rules mode is gone. `namespace`/`name`
 * forward to every page the same way {@link listRulesPage} applies them.
 */
export async function listAllRules(
  orgId: string,
  opts: { namespace?: string; name?: string } = {},
) {
  const all: z.infer<typeof CcRuleViewSchema>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRulesPage(orgId, {
      limit: 500,
      ...opts,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}
export async function getRule(orgId: string, id: string) {
  return CcRuleViewSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules/${id}`),
  );
}
/** CC's create body is the spec flattened beside `name`/`namespace` (CreateRuleBody). */
export async function createRule(orgId: string, input: CcRuleInput) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", "/v1/rules", CcRuleInputSchema.parse(input)),
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

// ---- SLOs ----
// List and get return the SloView (bare Slo + required `updated_at`);
// create/update/pause/resume answer the bare Slo, so they keep CcSloSchema.
export async function listSlos(
  orgId: string,
  opts: { namespace?: string; name?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.namespace !== undefined) params.set("namespace", opts.namespace);
  if (opts.name !== undefined) params.set("name", opts.name);
  const qs = params.toString();
  return z
    .array(CcSloViewSchema)
    .parse(await ccRequest(orgId, "GET", `/v1/slos${qs ? `?${qs}` : ""}`));
}
export async function getSlo(orgId: string, id: string) {
  return CcSloViewSchema.parse(await ccRequest(orgId, "GET", `/v1/slos/${id}`));
}
/**
 * The evaluator's latest status snapshot. CC 404s until the first evaluation
 * tick writes one, so a 404 here reads as "no snapshot yet" (null) rather
 * than an error — the SLO's own existence is the GET /v1/slos/:id read.
 */
export async function getSloStatus(orgId: string, id: string) {
  try {
    return CcSloStatusSchema.parse(
      await ccRequest(orgId, "GET", `/v1/slos/${id}/status`),
    );
  } catch (error) {
    if (error instanceof CcApiError && error.status === 404) return null;
    throw error;
  }
}
/** CC's create body is the spec flattened beside `name` (CreateSloBody). */
export async function createSlo(orgId: string, input: CcSloInput) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", "/v1/slos", CcSloInputSchema.parse(input)),
  );
}
/**
 * Full-body replace of the spec (no name/namespace: identity is immutable
 * after create), with optional `version` for optimistic concurrency: a stale
 * version answers 409 conflict and writes nothing; omitting it is
 * last-write-wins. The paused flag is not part of the spec and survives
 * updates.
 */
export async function updateSlo(
  orgId: string,
  id: string,
  input: CcSloUpdate,
  version?: number,
) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/slos/${id}`, {
      ...CcSloUpdateSchema.parse(input),
      ...(version === undefined ? {} : { version }),
    }),
  );
}
export async function deleteSlo(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/slos/${id}`),
  );
}
export async function pauseSlo(orgId: string, id: string) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", `/v1/slos/${id}/pause`),
  );
}
export async function resumeSlo(orgId: string, id: string) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", `/v1/slos/${id}/resume`),
  );
}
/**
 * Dry-run probe: validates the posted spec and runs the SLI over the spec's
 * own budget window — no DB write, no snapshot. Like rules::test, the path id
 * is ignored by CC; passed anyway so the URL stays truthful.
 */
export async function testSlo(orgId: string, id: string, input: CcSloInput) {
  return CcSloTestResultSchema.parse(
    await ccRequest(
      orgId,
      "POST",
      `/v1/slos/${id}/test`,
      CcSloInputSchema.parse(input),
    ),
  );
}

// ---- Channels ----
export async function listChannels(orgId: string) {
  return z
    .array(CcChannelSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/channels"));
}
/** CC's POST /v1/channels is create-only: an existing name answers 409. */
export async function createChannel(
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
/** CC's POST /v1/receivers is create-only: an existing name answers 409. */
export async function createReceiver(
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
