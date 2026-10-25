import type { EventPublisher } from "@everr/app/composition";
import type { Database } from "@everr/app/db/database";
import { organization } from "@everr/app/db/schema";
import {
  usefulConsultation,
  organizationMilestoneDefinitions,
  type UsefulConsultation,
  type UsefulConsultations,
  type OrganizationMilestoneEvent,
} from "@everr/app/organizations/consultations";
import { safeEventPublisher } from "@everr/app/server/events/safe-publication";
import { eq, sql } from "drizzle-orm";
import { organizationMilestones } from "../db/schema/organization-milestones";
import { milestoneDiagnostic, type MilestoneDiagnostics } from "./telemetry";

type Observation = {
  evidence: UsefulConsultation;
  observedAt: Date;
  observerStartedAt: Date;
};

export function createOrganizationMilestoneStore(database: Database) {
  return {
    async establish(observation: Observation): Promise<boolean> {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`);
        const { evidence, observedAt, observerStartedAt } = observation;
        // Authorization belongs to the completed action. A later Membership departure
        // does not falsify it. Only protect the source Organization from concurrent deletion.
        const [source] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, evidence.organizationId))
          .for("share");
        if (!source) throw new Error("Consultation Organization no longer exists");
        const rows = await tx
          .insert(organizationMilestones)
          .values({
            organizationId: evidence.organizationId,
            ruleVersion: 1,
            observerStartedAt,
            firstQueryableAt: observedAt,
            activatedAt: observedAt,
            surface: evidence.evidence.surface,
          })
          .onConflictDoNothing()
          .returning({ organizationId: organizationMilestones.organizationId });
        return rows.length === 1;
      });
    },
  };
}

/** Bounded, fire-and-forget observation owned by Cloud, without an intermediate event. */
export function createUsefulConsultations(options: {
  store: ReturnType<typeof createOrganizationMilestoneStore>;
  events: EventPublisher<OrganizationMilestoneEvent>;
  diagnostics?: MilestoneDiagnostics;
  now?: () => Date;
  maxInFlight?: number;
  drainTimeoutMs?: number;
}): UsefulConsultations {
  const now = options.now ?? (() => new Date());
  const observerStartedAt = new Date(now().getTime());
  const diagnostics = options.diagnostics ?? milestoneDiagnostic;
  const maxInFlight = options.maxInFlight ?? 32;
  const drainTimeoutMs = options.drainTimeoutMs ?? 3000;
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("Invalid publication capacity");
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0)
    throw new Error("Invalid publication drain timeout");
  const report = (stage: Parameters<MilestoneDiagnostics["log"]>[0]) => {
    for (const emit of [() => diagnostics.log(stage), () => diagnostics.count(stage)]) {
      try {
        void Promise.resolve(emit()).catch(() => {});
      } catch {
        // Diagnostics cannot affect a completed action or suppress the other signal.
      }
    }
  };
  const events = safeEventPublisher(options.events, organizationMilestoneDefinitions, {
    log: () => diagnostics.log("publication"),
    count: () => diagnostics.count("publication"),
  });
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let stopping: Promise<void> | undefined;

  function observe(observation: UsefulConsultation): void {
    if (closed || inFlight.size >= maxInFlight) {
      report(closed ? "closed" : "overload");
      return;
    }
    let evidence: UsefulConsultation;
    try {
      // Zod owns a synchronous copy, before callers can mutate their evidence.
      evidence = usefulConsultation.parse(observation);
    } catch {
      report("validation");
      return;
    }
    let occurredAt: string;
    try {
      occurredAt = now().toISOString();
      if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("Invalid observation clock");
    } catch {
      report("envelope");
      return;
    }
    const observedAt = new Date(occurredAt);
    const work = Promise.resolve()
      .then(async () => {
        if (observedAt < observerStartedAt) throw new Error("Invalid observation clock");
        if (!(await options.store.establish({ evidence, observedAt, observerStartedAt }))) return;
        // Source marker transaction has committed. Each fact remains independent best effort.
        for (const type of ["telemetry.first_queryable", "organization.activated"] as const) {
          events.publish({
            type,
            version: 1,
            subjectId: evidence.organizationId,
            data: {
              organizationId: evidence.organizationId,
              ruleVersion: 1,
              observedAt: occurredAt,
            },
          });
        }
      })
      .catch(() => report("storage"));
    inFlight.add(work);
    void work.then(() => inFlight.delete(work));
  }

  function stop(): Promise<void> {
    closed = true;
    stopping ??= new Promise<void>((resolve) => {
      if (inFlight.size === 0) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        report("drain");
        resolve();
      }, drainTimeoutMs);
      void Promise.allSettled(inFlight).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return stopping;
  }
  return { observe, stop };
}
