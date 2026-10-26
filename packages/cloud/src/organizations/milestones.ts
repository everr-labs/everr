import type { EventPublisher } from "@everr/app/composition";
import type { Database } from "@everr/app/db/database";
import { organization } from "@everr/app/db/schema";
import type {
  ConsultedTrace,
  TraceConsultation,
  TraceConsultations,
} from "@everr/app/organizations/consultations";
import type { OrganizationMilestoneEvent } from "./events";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { organizationMilestones } from "../db/schema/organization-milestones";
import { milestoneDiagnostic, type MilestoneDiagnostics } from "./telemetry";

const id = z.string().trim().min(1).max(512);
const traceConsultation = z
  .object({
    principal: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("member"), organizationId: id, userId: id, membershipId: id })
        .strict(),
      z.object({ kind: z.literal("client"), organizationId: id, clientId: id }).strict(),
    ]),
    surface: z.enum(["ui", "cli", "mcp"]),
    traces: z
      .array(
        z
          .object({
            traceId: id,
            serviceName: z.string(),
            resourceAttributes: z.unknown(),
            spanAttributes: z.unknown(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .refine((value) => value.surface !== "ui" || value.principal.kind === "member");

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function rawAttribute(value: unknown, key: string): unknown {
  const attributes = record(value);
  if (!attributes) return undefined;
  let current: unknown = attributes[key];
  if (current === undefined) {
    current = attributes;
    for (const part of key.split(".")) current = record(current)?.[part];
  }
  return current;
}

function attribute(value: unknown, key: string): string {
  const current = rawAttribute(value, key);
  return typeof current === "string" || typeof current === "number" ? String(current) : "";
}

function excludedAttributes(value: unknown): boolean {
  const attributes = record(value);
  if (!attributes) return false;
  return Object.entries(attributes).some(([key, item]) => {
    if (/(?:^|\.)(?:test|testdata|test_data|demo|synthetic|internal)(?:\.|$)/i.test(key)) {
      return item !== false && item !== "false" && item !== 0 && item !== "0" && item !== "";
    }
    return typeof item === "object" && item !== null && excludedAttributes(item);
  });
}

function isCustomerTrace(row: ConsultedTrace): boolean {
  const resource = row.resourceAttributes;
  const namespace = attribute(resource, "service.namespace").toLowerCase();
  // Names are exclusions only. A plausible service name never proves origin.
  if (
    /(?:^|[-_.])(?:everr|demo|test|synthetic|telemetrygen|verify)(?:$|[-_.])/i.test(
      row.serviceName,
    ) ||
    namespace === "everr" ||
    /^everr-labs\//i.test(attribute(resource, "vcs.repository.name")) ||
    excludedAttributes(resource) ||
    excludedAttributes(row.spanAttributes) ||
    ["everr.telemetry.provenance", "everr.data.provenance"].some((key) =>
      /test|demo|synthetic|internal|everr/i.test(attribute(resource, key)),
    )
  )
    return false;

  if (
    namespace === "cicd" &&
    attribute(resource, "vcs.provider.name") === "github" &&
    /^[1-9]\d*$/.test(attribute(resource, "cicd.pipeline.run.id")) &&
    /^[^/\s]+\/[^/\s]+$/.test(attribute(resource, "vcs.repository.name")) &&
    attribute(resource, "cicd.pipeline.name").trim()
  )
    return true;

  const currentEnvironment = rawAttribute(resource, "deployment.environment.name");
  const environment =
    currentEnvironment === undefined
      ? attribute(resource, "deployment.environment")
      : currentEnvironment;
  return environment === "production";
}

type Observation = {
  organizationId: string;
  surface: TraceConsultation["surface"];
  observedAt: Date;
  observerStartedAt: Date;
};

export function createOrganizationMilestoneStore(database: Database) {
  return {
    async establish(observation: Observation): Promise<boolean> {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`);
        const { organizationId, surface, observedAt, observerStartedAt } = observation;
        // Authorization belongs to the completed action. A later Membership departure
        // does not falsify it. Only protect the source Organization from concurrent deletion.
        const [source] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .for("share");
        if (!source) throw new Error("Consultation Organization no longer exists");
        const rows = await tx
          .insert(organizationMilestones)
          .values({
            organizationId,
            ruleVersion: 1,
            observerStartedAt,
            firstQueryableAt: observedAt,
            activatedAt: observedAt,
            surface,
          })
          .onConflictDoNothing()
          .returning({ organizationId: organizationMilestones.organizationId });
        return rows.length === 1;
      });
    },
  };
}

/** Bounded, fire-and-forget observation owned by Cloud, without an intermediate event. */
export function createTraceConsultations(options: {
  store: ReturnType<typeof createOrganizationMilestoneStore>;
  events: EventPublisher<OrganizationMilestoneEvent>;
  diagnostics?: MilestoneDiagnostics;
  now?: () => Date;
  maxInFlight?: number;
  drainTimeoutMs?: number;
}): TraceConsultations {
  const now = options.now ?? (() => new Date());
  const observerStartedAt = new Date(now().getTime());
  const diagnostics = options.diagnostics ?? milestoneDiagnostic;
  const maxInFlight = options.maxInFlight ?? 32;
  const drainTimeoutMs = options.drainTimeoutMs ?? 3000;
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("Invalid publication capacity");
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0)
    throw new Error("Invalid publication drain timeout");
  const report = (stage: Parameters<MilestoneDiagnostics>[0]) => {
    try {
      void Promise.resolve(diagnostics(stage)).catch(() => {});
    } catch {
      // An injected reporter cannot affect a completed action.
    }
  };
  const events = options.events;
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let stopping: Promise<void> | undefined;

  function observe(observation: TraceConsultation): void {
    if (closed || inFlight.size >= maxInFlight) {
      report(closed ? "closed" : "overload");
      return;
    }
    let consultation: TraceConsultation;
    try {
      // Classify completed data synchronously; persistence receives only owned scalar values.
      consultation = traceConsultation.parse(observation);
      if (!consultation.traces.some(isCustomerTrace)) return;
    } catch {
      report("validation");
      return;
    }
    const organizationId = consultation.principal.organizationId;
    const surface = consultation.surface;
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
        if (
          !(await options.store.establish({
            organizationId,
            surface,
            observedAt,
            observerStartedAt,
          }))
        )
          return;
        // Source marker transaction has committed. Each fact remains independent best effort.
        for (const type of ["telemetry.first_queryable", "organization.activated"] as const) {
          await events.publish({
            type,
            version: 1,
            subjectId: organizationId,
            data: {
              organizationId,
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
