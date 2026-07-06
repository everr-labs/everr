import { z } from "zod";
import {
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_SLACK_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
} from "@/data/alerts/delivery-settings";
// Single source of truth for the ownership annotation keys (shared with the
// simple-alert reconciler in data/alerts/mapping.ts).
import {
  isManagedSimple,
  OWN_MANAGED,
  OWN_NAME,
  OWN_REPO,
  previewIdOf,
} from "@/data/alerts/mapping";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import * as client from "./client";

// everr.managed value stamped on receivers this repo owns as code. Lets pruning
// tell THIS repo's as-code receivers apart from settings-owned org defaults and
// receivers created out-of-band (which never carry it). Distinct from the
// simple-alert rules' "simple", so the two never collide.
const MANAGED_AS_CODE = "as-code";

// The org-default receivers are owned by the delivery-settings flow, not
// as-code, so they never carry the as-code marker — but we also name-guard them
// so a hand-stamped default can never be pruned here.
const DEFAULT_RECEIVER_NAMES = new Set<string>([
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
  DEFAULT_SLACK_RECEIVER,
]);

// ---- Resource schemas (apply YAML, camelCase) ----
const CcRuleResourceSchema = z
  .object({
    kind: z.literal("CCAlertRule"),
    metadata: z.object({ name: z.string().min(1) }).strict(),
    spec: z
      .object({
        sql: z.string(),
        evaluationInterval: z.string(),
        for: z.string().default("0s"),
        labelColumns: z.array(z.string()).default([]),
        valueColumn: z.string().nullable().optional(),
        severity: z.enum(["info", "warning", "critical"]),
        annotations: z.record(z.string(), z.string()).default({}),
        resolveAfter: z.number().int().default(1),
      })
      .strict(),
  })
  .strict();

const CcReceiverResourceSchema = z
  .object({
    kind: z.literal("CCReceiver"),
    metadata: z.object({ name: z.string().min(1) }).strict(),
    spec: z
      .object({
        channel: z.discriminatedUnion("type", [
          z.object({ type: z.literal("webhook"), url: z.string() }),
          z.object({ type: z.literal("slack"), url: z.string() }),
          z.object({ type: z.literal("pagerduty"), routing_key: z.string() }),
          z.object({ type: z.literal("email"), to: z.array(z.string()) }),
          z.object({
            type: z.literal("telegram"),
            bot_token: z.string(),
            chat_ids: z.array(z.string()),
          }),
        ]),
      })
      .strict(),
  })
  .strict();

/** "30s","5m","1h","2d" -> seconds. */
function durationToSecs(s: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s}`);
  const n = Number(m[1]);
  return m[2] === "d"
    ? n * 86400
    : m[2] === "h"
      ? n * 3600
      : m[2] === "m"
        ? n * 60
        : n;
}

function toRuleSpec(r: z.infer<typeof CcRuleResourceSchema>, repoid: string) {
  return {
    sql: r.spec.sql,
    interval_secs: durationToSecs(r.spec.evaluationInterval),
    for_secs: durationToSecs(r.spec.for),
    label_columns: r.spec.labelColumns,
    value_column: r.spec.valueColumn ?? null,
    severity: r.spec.severity,
    annotations: {
      ...r.spec.annotations,
      [OWN_NAME]: r.metadata.name,
      [OWN_REPO]: repoid,
    },
    resolve_after: r.spec.resolveAfter,
  };
}

// Stable identity for change detection: everything except ownership annotations.
// Annotation key order is NOT stable across the YAML source and CC's response,
// so we sort the annotation entries before hashing — otherwise a rule with 2+
// annotations would look "changed" on every apply and be needlessly
// deleted+recreated. (Top-level spec key order is already aligned between the
// desired literal and the schema-parsed CC response.)
function specFingerprint(spec: Record<string, unknown>): string {
  const ann = { ...(spec.annotations as Record<string, string> | undefined) };
  delete ann[OWN_NAME];
  delete ann[OWN_REPO];
  const sortedAnnotations = Object.fromEntries(
    Object.entries(ann).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({ ...spec, annotations: sortedAnnotations });
}

// CC resources live in the external CC service, scoped by their `everr.repoid`
// marker: no cross-repo (project, slug) ownership and no Postgres preview
// overlay. Returned for both the "no adoption" and "previews are a no-op" paths.
const NO_CC_CHANGES: {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: never[];
} = { created: [], updated: [], deleted: [], adopted: [], conflicts: [] };

// True for CC's optimistic-concurrency failure (PUT with a stale `version`).
// Matched structurally instead of importing CcApiError so this module does not
// pull the transport (and its env validation) into the test import graph.
// (Intentionally duplicated in data/alerts/apply.server.ts per the
// no-dedupe-reconciler-boilerplate convention.)
function isCcVersionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "CcApiError" &&
    (error as { status?: unknown }).status === 409
  );
}

export const applyCcRuleSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
}) => {
  const { orgId, repoid } = namespace;
  // CC has no preview concept: a preview apply must never mutate shared CC state.
  if (namespace.kind === "preview") return NO_CC_CHANGES;

  const desired = resources.map((e) => {
    const parsed = CcRuleResourceSchema.parse(e.resource);
    return {
      name: parsed.metadata.name,
      path: e.path,
      spec: toRuleSpec(parsed, repoid),
    };
  });

  // Scope to this repo's LIVE, power-user CCAlertRule rules:
  //  - everr.repoid == this repo (never another repo's rules);
  //  - no everr.preview annotation — preview AlertRules (suppressed rules
  //    tagged by the simple-alert reconciler) also carry this repo's
  //    everr.repoid, and adopting them here would delete every preview rule on
  //    each live apply;
  //  - NOT everr.managed == "simple" — simple AlertRules created by
  //    data/alerts/apply.server.ts share this repo's everr.repoid and (being
  //    live) carry no everr.preview marker, so without this exclusion a repo
  //    mixing both kinds would prune its simple rules here. The simple
  //    reconciler scopes the mirror way (it requires everr.managed == "simple"),
  //    so the two reconcilers can never touch each other's rules.
  const existing = (await client.listRules(orgId)).filter(
    (r) =>
      r.spec.annotations?.[OWN_REPO] === repoid &&
      previewIdOf(r.spec) === null &&
      !isManagedSimple(r.spec, repoid),
  );
  const existingByName = new Map(
    existing.map((r) => [r.spec.annotations?.[OWN_NAME] ?? "", r]),
  );

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  for (const d of desired) {
    const cur = existingByName.get(d.name);
    if (!cur) {
      if (!dryRun) await client.createRule(orgId, d.spec as never);
      created.push(d.name);
    } else if (
      specFingerprint(cur.spec as Record<string, unknown>) !==
      specFingerprint(d.spec)
    ) {
      // Update in place: preserves the rule id and instance state (CC clears
      // instances only when the label_columns set changes). The stored version
      // guards against concurrent edits.
      if (!dryRun) {
        try {
          await client.updateRule(orgId, cur.id, d.spec as never, cur.version);
        } catch (error) {
          if (isCcVersionConflict(error)) {
            throw new ApplyValidationError(
              `${d.path}: rule "${d.name}" was modified concurrently in clickety-clack (version conflict); re-run apply`,
            );
          }
          throw error;
        }
      }
      updated.push(d.name);
    }
    existingByName.delete(d.name);
  }
  for (const [name, cur] of existingByName) {
    if (!dryRun) await client.deleteRule(orgId, cur.id);
    deleted.push(name);
  }
  return { created, updated, deleted, adopted: [], conflicts: [] };
};

export const applyCcReceiverSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
}) => {
  const { orgId, repoid } = namespace;
  // CC has no preview concept: a preview apply must never mutate shared CC state.
  if (namespace.kind === "preview") return NO_CC_CHANGES;

  const desired = resources.map((e) =>
    CcReceiverResourceSchema.parse(e.resource),
  );
  const desiredNames = new Set(desired.map((d) => d.metadata.name));

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const existing = await client.listReceivers(orgId);
  const existingNames = new Set(existing.map((r) => r.name));

  for (const d of desired) {
    if (!dryRun) {
      // Stamp ownership on every upsert so pruning can tell THIS repo's
      // as-code receivers apart from other repos', out-of-band ones, and the
      // settings-owned org defaults. CC's upsert REPLACES the stored annotation
      // map, so the markers must be re-sent on each write. (The CCReceiver YAML
      // schema exposes no `annotations` field, so there are no spec-provided
      // annotations to preserve.)
      const body = {
        name: d.metadata.name,
        channel: d.spec.channel,
        annotations: { [OWN_REPO]: repoid, [OWN_MANAGED]: MANAGED_AS_CODE },
      };
      await client.upsertReceiver(orgId, body);
    }
    (existingNames.has(d.metadata.name) ? updated : created).push(
      d.metadata.name,
    );
  }

  // Prune receivers this repo previously managed as code (its everr.repoid +
  // the as-code marker) that the config no longer declares. The marker keeps
  // pruning scoped to THIS repo: other repos' receivers, out-of-band ones, and
  // the settings-owned org defaults never carry it (and defaults are
  // name-guarded regardless).
  const prunable = existing.filter(
    (r) =>
      r.annotations?.[OWN_REPO] === repoid &&
      r.annotations?.[OWN_MANAGED] === MANAGED_AS_CODE &&
      !desiredNames.has(r.name) &&
      !DEFAULT_RECEIVER_NAMES.has(r.name),
  );

  if (prunable.length > 0) {
    // A receiver still referenced by a route cannot be deleted without breaking
    // delivery, so fail the apply (naming the referencing route ids) instead of
    // dropping the reference. Checked up front so a blocked deletion aborts
    // before any receiver is removed. Managed catch-all routes reference only
    // the default receivers, so this mainly guards user-authored routes.
    const routes = await client.listRoutes(orgId);
    const blocked = prunable
      .map((r) => ({
        name: r.name,
        routeIds: routes
          .filter((rt) => rt.receiver === r.name)
          .map((rt) => rt.id),
      }))
      .filter((b) => b.routeIds.length > 0);
    if (blocked.length > 0) {
      const detail = blocked
        .map(
          (b) =>
            `receiver "${b.name}" is referenced by route(s) ${b.routeIds.join(", ")}`,
        )
        .join("; ");
      throw new ApplyValidationError(
        `cannot delete ${detail}: remove the route reference before removing the receiver from config`,
      );
    }
    for (const r of prunable) {
      // Respect dry-run: report the would-be deletion without calling delete
      // (mirrors the rule reconciler above).
      if (!dryRun) await client.deleteReceiver(orgId, r.name);
      deleted.push(r.name);
    }
  }

  return { created, updated, deleted, adopted: [], conflicts: [] };
};
