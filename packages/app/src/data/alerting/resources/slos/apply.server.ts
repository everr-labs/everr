import { AlertingError } from "@/data/alerting/errors";
import * as alerting from "@/data/alerting/repository";
import type { AlertingSloSpec, AlertingSloView } from "@/data/alerting/types";
import { ApplyValidationError } from "@/data/as-code/errors";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { OwnershipConflict } from "@/data/as-code/ownership";
import { stableStringify } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { authEnv } from "@/env/auth";
import { createLimiter } from "@/lib/limiter";
import { errorMessage } from "@/telemetry/logger";
import { fromAlertingSlo, isOwnedSlo, toSloInput } from "./mapping";
import { type SloYaml, SloYamlSchema } from "./schema";

interface ApplySlosResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
  note?: string;
}

// Preview evaluations are real, but notification delivery is suppressed.
const PREVIEW_NOTE =
  "preview SLOs are fully evaluated by the alert worker (suppressed): " +
  "burn-rate instances and history are real, but no notifications are sent.";

// Each validation scans a full budget window, so bound ClickHouse load.
const SLO_TEST_CONCURRENCY = 8;

const ALERTING_MUTATION_CONCURRENCY = 8;

function sloFingerprint(spec: AlertingSloSpec): string {
  return stableStringify(spec);
}

function isAlertingVersionConflict(error: unknown): boolean {
  return error instanceof AlertingError && error.status === 409;
}

function parseSlo(path: string, resource: unknown): SloYaml {
  const parsed = SloYamlSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ApplyValidationError(
      `${path}: invalid SLO: ${parsed.error.issues[0]?.message ?? "invalid SLO"}`,
    );
  }
  return parsed.data;
}

/** Reconciles one repo's live or preview SLOs without crossing ownership scopes. */
export const applySloSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  adopt,
}): Promise<ApplySlosResult> => {
  const { orgId, repoid } = namespace;
  const previewId = namespace.kind === "preview" ? namespace.id : null;

  // 1. Parse and validate every desired SLO.
  const seen = new Map<string, string>();
  const parsed = resources.map(({ path, resource }) => {
    const slo = parseSlo(path, resource);
    // Project is part of resource identity.
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

  const appBaseUrl = authEnv.BETTER_AUTH_URL;

  // A new preview has nothing to list yet.
  const listed: AlertingSloView[] =
    namespace.kind === "preview" && namespace.id === null
      ? []
      : await alerting.listSlos(orgId);

  const desired = parsed.map((p) => {
    const input = toSloInput(p.slo, repoid, {
      appBaseUrl,
      previewId: previewId ?? undefined,
    });
    const {
      name,
      repoid: resourceRepoid,
      previewId: _previewId,
      ...spec
    } = input;
    return {
      name,
      repoid: resourceRepoid,
      path: p.path,
      spec: spec as AlertingSloSpec,
    };
  });

  // 2. Scope existing SLOs to this repo and live/preview target.
  const existing = listed.filter(
    (s) => isOwnedSlo(s, repoid) && s.previewId === previewId,
  );
  const existingByName = new Map(existing.map((s) => [s.name, s]));

  // 3. Plan creates and changed SLOs.
  const updates: { d: (typeof desired)[number]; cur: AlertingSloView }[] = [];
  const creates: (typeof desired)[number][] = [];
  for (const d of desired) {
    const cur = existingByName.get(d.name);
    if (!cur) {
      creates.push(d);
    } else if (sloFingerprint(cur.spec) !== sloFingerprint(d.spec)) {
      updates.push({ d, cur });
    }
  }

  // 4. Resolve cross-repo ownership for live creates.
  const foreignByName =
    namespace.kind === "live"
      ? new Map(
          listed
            .filter((s) => s.previewId === null && !isOwnedSlo(s, repoid))
            .map((s) => [s.name, s]),
        )
      : new Map<string, AlertingSloView>();
  const taken = creates.flatMap((d) => {
    const foreign = foreignByName.get(d.name);
    return foreign ? [{ d, foreign }] : [];
  });
  const fresh = creates.filter((d) => !foreignByName.has(d.name));
  const conflicts: OwnershipConflict[] = adopt
    ? []
    : taken.map(({ d, foreign }) => {
        const { project, slug } = parseResourceName(d.name);
        return { project, slug, owner: fromAlertingSlo(foreign).repoid };
      });
  const adopted = adopt ? taken.map(({ d }) => d.name) : [];

  // 5. Validate every changed spec and its SLI query without writing.
  const toValidate = [
    ...fresh,
    ...(adopt ? taken.map(({ d }) => d) : []),
    ...updates.map(({ d }) => d),
  ];
  const runValidation = createLimiter(SLO_TEST_CONCURRENCY);
  const validations = await Promise.allSettled(
    toValidate.map((d) =>
      runValidation(undefined, () => alerting.testSlo(orgId, d.spec)),
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

  // 6. Converge in a bounded pool, preserving deterministic errors.
  const runMutation = createLimiter(ALERTING_MUTATION_CONCURRENCY);
  const writes = await Promise.allSettled([
    ...fresh.map((d) =>
      runMutation(undefined, async () => {
        if (!dryRun) {
          await alerting.createSlo(orgId, {
            name: d.name,
            repoid: d.repoid,
            previewId,
            ...d.spec,
          });
        }
      }),
    ),
    ...(adopt
      ? taken.map(({ d, foreign }) =>
          runMutation(undefined, async () => {
            if (dryRun) return;
            await alerting.adoptSlo(
              orgId,
              foreign.id,
              d.repoid,
              foreign.version,
              d.spec,
            );
          }),
        )
      : []),
    ...updates.map(({ d, cur }) =>
      runMutation(undefined, async () => {
        if (dryRun) return;
        try {
          await alerting.updateSlo(orgId, cur.id, d.spec, cur.version);
        } catch (error) {
          if (isAlertingVersionConflict(error)) {
            throw new ApplyValidationError(
              `${d.path}: SLO "${d.name}" was modified concurrently (version conflict); re-run apply`,
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

  // 7. Prune scoped SLOs only after all writes succeed.
  const desiredNames = new Set(desired.map((d) => d.name));
  const stale = [...existingByName].filter(([name]) => !desiredNames.has(name));
  const deleted: string[] = [];
  const deletions = await Promise.allSettled(
    stale.map(([, cur]) =>
      runMutation(undefined, async () => {
        if (!dryRun) await alerting.deleteSlo(orgId, cur.id);
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
