import { ApplyValidationError } from "@/data/as-code/errors";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { OwnershipConflict } from "@/data/as-code/ownership";
import { stableStringify } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import * as cc from "@/data/cc/client";
import { CcApiError } from "@/data/cc/errors";
import type { CcSloSpec, CcSloView } from "@/data/cc/types";
import { authEnv } from "@/env/auth";
import { createLimiter } from "@/lib/limiter";
import { errorMessage } from "@/telemetry/logger";
import { fromCcSlo, isOwnedSlo, OWN_REPO, toSloInput } from "./mapping";
import { type SloYaml, SloYamlSchema } from "./schema";

interface ApplySlosResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
  note?: string;
}

// Surfaced on every preview apply: the SLOs ARE registered and evaluated in CC
// (burn-rate instances, status snapshots, history) as suppressed SLOs, so a
// reviewer can watch what they would have done — but the dispatcher never
// notifies on them.
const PREVIEW_NOTE =
  "preview SLOs are fully evaluated by clickety-clack (suppressed): " +
  "burn-rate instances and history are real, but no notifications are sent.";

// One repo can declare many SLOs; each validation probe runs the SLI over the
// spec's full budget window against ClickHouse, so cap the in-flight tests
// (same bound as the alerts validation pool).
const SLO_TEST_CONCURRENCY = 8;

// Cap on in-flight CC mutations during a reconcile. Per-SLO operations are
// independent (CC keys SLOs by id, matched here by name before any call), so
// they run in a bounded pool instead of strictly one at a time.
const CC_MUTATION_CONCURRENCY = 8;

// Stable identity for change detection: everything except the ownership
// annotation (everr.repoid; identity itself now lives on the SLO's
// first-class name/namespace, not the spec), serialized with all object keys
// recursively sorted so no key order — the YAML source's, CC's serialization,
// or a parser's — can ever fake a diff (which would needlessly rewrite the
// SLO on every apply).
function sloFingerprint(spec: CcSloSpec): string {
  const annotations = { ...spec.annotations };
  delete annotations[OWN_REPO];
  return stableStringify({ ...spec, annotations });
}

// True for CC's optimistic-concurrency failure (PUT with a stale `version`).
function isCcVersionConflict(error: unknown): boolean {
  return error instanceof CcApiError && error.status === 409;
}

// Static validation: the SLO document schema (which mirrors CC's cheap
// validate_slo_spec checks — window placeholders, target bounds, reserved
// labels, tier shape). The SQL itself is validated by CC's test probe below.
function parseSlo(path: string, resource: unknown): SloYaml {
  const parsed = SloYamlSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ApplyValidationError(
      `${path}: invalid SLO: ${parsed.error.issues[0]?.message ?? "invalid SLO"}`,
    );
  }
  return parsed.data;
}

/**
 * Reconcile `kind: SLO` resources for one namespace against CC. An as-code SLO
 * IS a CC SLO owned by this repo (everr.repoid) whose first-class `namespace`
 * field is this reconcile's scope: "" for live, or exactly this preview's
 * registry id. We list CC SLOs, scope to THIS namespace's owned SLOs only —
 * this repo's, and within it the matching `namespace` — so other repos' SLOs
 * and the other side of the live/preview split are never touched — and
 * converge to the applied set, matching by the SLO's first-class `name`
 * (project/slug).
 *
 * Every new or changed spec is first validated through CC's dry-run test
 * endpoint (which validates the spec and runs the SLI query — no writes), so a
 * dry-run or preview apply catches broken SQL before anything lands. A changed
 * SLO is updated in place (PUT with the stored `version` as an optimistic-
 * concurrency guard, so burn-rate instance state survives); a scoped SLO
 * absent from config is deleted. Preview SLOs are created `suppressed` in
 * their own namespace: unlike rules, CC SLO names are unique per (tenant,
 * namespace), not per tenant, so a preview copy simply reuses the live name
 * under its own namespace, no name mangling needed.
 *
 * A create can collide with an out-of-scope live SLO on the (tenant, "")
 * name: that is the cross-repo ownership conflict (owner "" for a UI-created
 * SLO), reported for the registry's fail-fast — or taken over in place when
 * adopting, which preserves the SLO's id and instance state.
 */
export const applySloSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  adopt,
}): Promise<ApplySlosResult> => {
  const { orgId, repoid } = namespace;
  // The preview registry id scoping this reconcile; null = the live namespace.
  const previewId = namespace.kind === "preview" ? namespace.id : null;
  const wantNamespace = previewId ?? "";

  // 1. Parse + statically validate, rejecting duplicate names within the batch.
  const seen = new Map<string, string>();
  const parsed = resources.map(({ path, resource }) => {
    const slo = parseSlo(path, resource);
    // Identity is the qualified project/slug (the CC first-class name), so a
    // same-slug SLO in two different projects is two resources, not a dupe.
    const name = formatResourceName(
      slo.metadata.project ?? "default",
      slo.metadata.name,
    );
    const prior = seen.get(name);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate SLO "${name}" (${prior} and ${path})`,
      );
    }
    seen.set(name, path);
    return { slo, path };
  });

  // The everr app origin: the runbook link.runbook annotation must be
  // absolute for the SLO detail page to render it.
  const appBaseUrl = authEnv.BETTER_AUTH_URL;

  // A first-apply dry run has no preview registry row yet (previewId null on a
  // preview namespace would alias the LIVE scope), so it skips the listing:
  // nothing tagged with a not-yet-minted id can exist in CC.
  const listed: CcSloView[] =
    namespace.kind === "preview" && namespace.id === null
      ? []
      : await cc.listSlos(orgId);

  const desired = parsed.map((p) => {
    const input = toSloInput(p.slo, repoid, {
      appBaseUrl,
      previewId: previewId ?? undefined,
    });
    const { name, namespace: _namespace, ...spec } = input;
    return { name, path: p.path, spec: spec as CcSloSpec };
  });

  // 2. Scope to this namespace's OWNED SLOs only: this repo's, and matching
  // this namespace's first-class `namespace` field ("" = live, else this
  // preview's registry id). That check cuts both ways — a live apply never
  // adopts or prunes a preview's suppressed SLOs, and a preview apply never
  // touches live ones. SLOs are matched by the first-class `name`
  // (project/slug), not an annotation.
  const existing = listed.filter(
    (s) => isOwnedSlo(s, repoid) && s.namespace === wantNamespace,
  );
  const existingByName = new Map(existing.map((s) => [s.name, s]));

  // 3. Plan. An SLO matched by name is an update when its content changed;
  // otherwise unchanged.
  const updates: { d: (typeof desired)[number]; cur: CcSloView }[] = [];
  const creates: (typeof desired)[number][] = [];
  for (const d of desired) {
    const cur = existingByName.get(d.name);
    if (!cur) {
      creates.push(d);
    } else if (sloFingerprint(cur.spec) !== sloFingerprint(d.spec)) {
      updates.push({ d, cur });
    }
  }

  // 4. Cross-repo ownership: a live create can collide with a live SLO (same
  // tenant, namespace "") this repo does not own (another repo's, or a
  // UI-created one with no everr.repoid — owner ""). Reported as conflicts for
  // the registry's fail-fast, or taken over in place when adopting. Preview
  // creates never collide (their own namespace is disjoint from the live
  // one), and preview-namespaced SLOs are never adoption targets.
  const foreignByName =
    namespace.kind === "live"
      ? new Map(
          listed
            .filter((s) => s.namespace === "" && !isOwnedSlo(s, repoid))
            .map((s) => [s.name, s]),
        )
      : new Map<string, CcSloView>();
  const taken = creates.flatMap((d) => {
    const foreign = foreignByName.get(d.name);
    return foreign ? [{ d, foreign }] : [];
  });
  const fresh = creates.filter((d) => !foreignByName.has(d.name));
  const conflicts: OwnershipConflict[] = adopt
    ? []
    : taken.map(({ d, foreign }) => {
        const { project, slug } = parseResourceName(d.name);
        return { project, slug, owner: fromCcSlo(foreign).repoid };
      });
  const adopted = adopt ? taken.map(({ d }) => d.name) : [];

  // 5. Validate every spec that would be written through CC's dry-run test
  // probe (spec validation + the SLI query over its own budget window, zero
  // writes) in a bounded pool. Unchanged SLOs are skipped: their spec already
  // passed when it was written. Runs on dry-run too — that IS the validation
  // pass. Conflicted creates are skipped when not adopting (the registry
  // aborts on the conflicts before any write).
  const toValidate = [
    ...fresh,
    ...(adopt ? taken.map(({ d }) => d) : []),
    ...updates.map(({ d }) => d),
  ];
  const runValidation = createLimiter(SLO_TEST_CONCURRENCY);
  const validations = await Promise.allSettled(
    toValidate.map((d) =>
      runValidation(undefined, () => cc.testSlo(orgId, d.spec)),
    ),
  );
  toValidate.forEach((d, i) => {
    const outcome = validations[i];
    if (outcome.status === "rejected") {
      throw new ApplyValidationError(
        `${d.path}: ${errorMessage(outcome.reason)}`,
      );
    }
  });

  // 6. Converge. Mutations run in a bounded pool (skipped entirely on
  // dry-run); outcomes aggregate by input index and the first failure (in
  // input order) is rethrown, matching the alerts reconciler's deterministic
  // reporting.
  const runMutation = createLimiter(CC_MUTATION_CONCURRENCY);
  const writes = await Promise.allSettled([
    ...fresh.map((d) =>
      runMutation(undefined, async () => {
        if (!dryRun) {
          await cc.createSlo(orgId, {
            name: d.name,
            namespace: wantNamespace,
            ...d.spec,
          });
        }
      }),
    ),
    ...(adopt
      ? taken.map(({ d, foreign }) =>
          runMutation(undefined, async () => {
            if (dryRun) return;
            // Adoption: take over the foreign SLO in place — the version-
            // guarded PUT transfers ownership (everr.repoid) and applies the
            // desired content while preserving the id and instance state.
            // PUT takes the bare spec (identity is immutable after create).
            await cc.updateSlo(orgId, foreign.id, d.spec, foreign.version);
          }),
        )
      : []),
    ...updates.map(({ d, cur }) =>
      runMutation(undefined, async () => {
        if (dryRun) return;
        try {
          await cc.updateSlo(orgId, cur.id, d.spec, cur.version);
        } catch (error) {
          if (isCcVersionConflict(error)) {
            throw new ApplyValidationError(
              `${d.path}: SLO "${d.name}" was modified concurrently in the alert engine (version conflict); re-run apply`,
            );
          }
          throw error;
        }
      }),
    ),
  ]);
  for (const outcome of writes) {
    if (outcome.status === "rejected") throw outcome.reason;
  }

  // 7. Scoped SLOs absent from config are pruned, same bounded pool. Runs only
  // after every create/update settled cleanly.
  const desiredNames = new Set(desired.map((d) => d.name));
  const stale = [...existingByName].filter(([name]) => !desiredNames.has(name));
  const deleted: string[] = [];
  const deletions = await Promise.allSettled(
    stale.map(([, cur]) =>
      runMutation(undefined, async () => {
        if (!dryRun) await cc.deleteSlo(orgId, cur.id);
      }),
    ),
  );
  stale.forEach(([name], i) => {
    const outcome = deletions[i];
    if (outcome.status === "rejected") throw outcome.reason;
    deleted.push(name);
  });

  return {
    created: fresh.map((d) => d.name),
    updated: updates.map(({ d }) => d.name),
    deleted,
    adopted,
    conflicts,
    ...(namespace.kind === "preview" ? { note: PREVIEW_NOTE } : {}),
  };
};
