import { z } from "zod";
import {
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_SLACK_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
} from "@/data/alerts/delivery-settings";
// Single source of truth for the repo-ownership annotation key (shared with
// the AlertRule reconciler in data/alerts/mapping.ts).
import { OWN_REPO } from "@/data/alerts/mapping";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import * as client from "./client";

// The "everr.managed" annotation key stamped on receivers this repo owns as
// code, and its value here. Lets pruning tell THIS repo's as-code receivers
// apart from settings-owned org defaults and receivers created out-of-band
// (which never carry it). Receiver-only: the rule reconciler this once shared
// the key with was retired, so it now lives here next to its only user.
const OWN_MANAGED = "everr.managed";
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

// CC resources live in the external CC service, scoped by their `everr.repoid`
// marker: no cross-repo (project, slug) ownership and no Postgres preview
// overlay. Returned for the "previews are a no-op" path (CC has no preview
// concept, so a preview apply must never mutate shared CC state).
const NO_CC_CHANGES: {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: never[];
} = { created: [], updated: [], deleted: [], adopted: [], conflicts: [] };

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
      // Respect dry-run: report the would-be deletion without calling delete.
      if (!dryRun) await client.deleteReceiver(orgId, r.name);
      deleted.push(r.name);
    }
  }

  return { created, updated, deleted, adopted: [], conflicts: [] };
};
