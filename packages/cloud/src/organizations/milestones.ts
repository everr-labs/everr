import type { BusinessEvents } from "@everr/app/composition";
import type { Database } from "@everr/app/db/database";
import { organization } from "@everr/app/db/schema";
import {
  usefulConsultation,
  type UsefulConsultation,
  type UsefulConsultations,
  type OrganizationMilestoneFact,
} from "@everr/app/organizations/consultations";
import { createBusinessEventPublisher } from "@everr/app/server/business-events/publisher";
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

/** Reuses bounded publication admission, ownership of this observation stays in Cloud. */
export function createUsefulConsultations(options: {
  store: ReturnType<typeof createOrganizationMilestoneStore>;
  events: BusinessEvents<OrganizationMilestoneFact>;
  diagnostics?: MilestoneDiagnostics;
  now?: () => Date;
  maxInFlight?: number;
  drainTimeoutMs?: number;
}): UsefulConsultations {
  const now = options.now ?? (() => new Date());
  const observerStartedAt = now();
  const diagnostics = options.diagnostics ?? milestoneDiagnostic;
  const report = (stage: Parameters<MilestoneDiagnostics["log"]>[0]) => {
    for (const emit of [() => diagnostics.log(stage), () => diagnostics.count(stage)]) {
      try {
        void Promise.resolve(emit()).catch(() => {});
      } catch {
        // Diagnostics cannot affect a completed action or suppress the other signal.
      }
    }
  };
  const definition = {
    type: "telemetry.useful_consultation.observed",
    version: 1,
    parse(input: unknown) {
      if (typeof input !== "object" || input === null || !("data" in input))
        throw new Error("Invalid consultation observation");
      const evidence = usefulConsultation.parse(input.data);
      return {
        type: "telemetry.useful_consultation.observed",
        version: 1,
        subjectId: evidence.organizationId,
        data: evidence,
      };
    },
  };
  const publisher = createBusinessEventPublisher({
    definitions: [definition],
    subscribers: [
      {
        id: "cloud.organization-milestones",
        definition,
        async enqueue(event) {
          const evidence = usefulConsultation.parse(event.data);
          const observedAt = new Date(event.occurredAt);
          if (observedAt < observerStartedAt) throw new Error("Invalid observation clock");
          if (!(await options.store.establish({ evidence, observedAt, observerStartedAt }))) return;
          // Source marker transaction has committed. Each fact remains independent best effort.
          for (const type of ["telemetry.first_queryable", "organization.activated"] as const) {
            try {
              options.events.publish({
                type,
                version: 1,
                subjectId: evidence.organizationId,
                data: {
                  organizationId: evidence.organizationId,
                  ruleVersion: 1,
                  observedAt: event.occurredAt,
                },
              });
            } catch {
              report("publication");
            }
          }
        },
      },
    ],
    metadata: () => ({ id: crypto.randomUUID(), occurredAt: now().toISOString() }),
    maxInFlight: options.maxInFlight ?? 32,
    drainTimeoutMs: options.drainTimeoutMs ?? 3000,
    diagnostics: {
      log: (failure) => report(failure.stage === "subscriber" ? "storage" : failure.stage),
      count: () => {},
    },
  });
  return {
    observe(observation) {
      // The publisher validates and copies the entire typed payload before async work.
      publisher.publish({
        type: definition.type,
        version: 1,
        subjectId: "observation",
        data: observation,
      });
    },
    stop: publisher.stop,
  };
}
