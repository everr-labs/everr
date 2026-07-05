import { z } from "zod";
// Single source of truth for the ownership annotation keys (shared with the
// simple-alert reconciler in data/alerts/mapping.ts).
import { OWN_NAME, OWN_REPO } from "@/data/alerts/mapping";
import type { Reconciler } from "@/data/as-code/registry";
import * as client from "./client";

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

/** "30s","5m","1h" -> seconds. */
function durationToSecs(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s}`);
  const n = Number(m[1]);
  return m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
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
    return { name: parsed.metadata.name, spec: toRuleSpec(parsed, repoid) };
  });

  const existing = (await client.listRules(orgId)).filter(
    (r) => (r.spec.annotations ?? {})[OWN_REPO] === repoid,
  );
  const existingByName = new Map(
    existing.map((r) => [(r.spec.annotations ?? {})[OWN_NAME] ?? "", r]),
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
      // CC rules are immutable: delete + recreate.
      if (!dryRun) {
        await client.deleteRule(orgId, cur.id);
        await client.createRule(orgId, d.spec as never);
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
  const { orgId } = namespace;
  // CC has no preview concept: a preview apply must never mutate shared CC state.
  if (namespace.kind === "preview") return NO_CC_CHANGES;

  const desired = resources.map((e) =>
    CcReceiverResourceSchema.parse(e.resource),
  );

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const existing = await client.listReceivers(orgId);
  const existingNames = new Set(existing.map((r) => r.name));

  for (const d of desired) {
    if (!dryRun)
      await client.upsertReceiver(orgId, {
        name: d.metadata.name,
        channel: d.spec.channel,
      });
    (existingNames.has(d.metadata.name) ? updated : created).push(
      d.metadata.name,
    );
  }
  // Receivers are upsert-only via apply: unlike rules, CC receivers carry no
  // ownership annotations, so we cannot tell which receivers belong to THIS
  // repo. Pruning by "absent from config" would be tenant-wide and would delete
  // receivers owned by other repos or created out-of-band. We therefore never
  // delete here — receiver removal is a manual operation (UI/API). `deleted`
  // stays empty by design.
  return { created, updated, deleted, adopted: [], conflicts: [] };
};
