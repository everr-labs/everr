import type { ApplicationEvents } from "@everr/app/composition";
import { eventRegistration } from "@everr/app/server/events/registration";
import {
  membershipEventDefinitions,
  organizationEventDefinitions,
  userEventDefinitions,
} from "@everr/app/identity/events";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
import { organizationMilestoneDefinitions } from "../organizations/events";
import { billingEventDefinitions } from "../billing/events";
import { addWorkerJob } from "@everr/app/server/worker/jobs";

import {
  USER_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  userSyncPayload,
  organizationSyncPayload,
  membershipSyncPayload,
  userSyncSpec,
  relatedSyncSpec,
} from "./commands";

export function userSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationEvents {
  if (mode === "disabled") return [];
  return userEventDefinitions.map((definition) =>
    eventRegistration(definition, {
      id: `crm.brevo.${definition.type}`,
      async enqueue(event) {
        if (event.subjectId !== event.data.userId) throw new Error("Invalid CRM user subject.");
        const payload = userSyncPayload.parse({
          version: 1,
          userId: event.data.userId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        await enqueue(USER_SYNC_TASK, payload, {
          ...userSyncSpec(payload.userId),
        });
      },
    }),
  );
}

export function organizationSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationEvents {
  if (mode === "disabled") return [];
  const definitions = [
    ...organizationEventDefinitions,
    ...membershipEventDefinitions,
    ...organizationReadinessEventDefinitions,
    ...billingEventDefinitions,
    ...organizationMilestoneDefinitions,
  ];
  return definitions.map((definition) =>
    eventRegistration(definition, {
      id: `crm.brevo.${definition.type}`,
      async enqueue(event) {
        const membership = "membershipId" in event.data;
        if (
          event.subjectId !==
          ("membershipId" in event.data ? event.data.membershipId : event.data.organizationId)
        )
          throw new Error("Invalid CRM organization subject.");
        const common = {
          version: 1,
          organizationId: event.data.organizationId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        };
        // The pair, not membership row identity or domain, is authoritative.
        const payload =
          membership && "userId" in event.data
            ? membershipSyncPayload.parse({
                ...common,
                kind: "membership",
                userId: event.data.userId,
              })
            : organizationSyncPayload.parse({ ...common, kind: "organization" });
        await enqueue(
          payload.kind === "membership" ? MEMBERSHIP_SYNC_TASK : ORGANIZATION_SYNC_TASK,
          payload,
          {
            ...relatedSyncSpec(
              payload.organizationId,
              payload.kind === "membership" ? payload.userId : undefined,
            ),
          },
        );
      },
    }),
  );
}
