import type { ApplicationEvents, EventRoute } from "@everr/app/composition";
import {
  membershipEventDefinitions,
  organizationEventDefinitions,
  userEventDefinitions,
  type UserEvent,
  type OrganizationEvent,
  type MembershipEvent,
} from "@everr/app/identity/events";
import { billingEventDefinitions, type BillingEvent } from "../billing/events";
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

/** Disabled mode admits no work; paused mode persists the same jobs without consuming them. */
export function crmEventRoutes(mode: "disabled" | "configured" | "paused"): ApplicationEvents {
  if (mode === "disabled") return [];
  return [
    ...userEventDefinitions.map((definition): EventRoute<UserEvent> => ({
      definition,
      job(event) {
        if (event.subjectId !== event.data.userId) throw new Error("Invalid CRM user subject.");
        const payload = userSyncPayload.parse({
          version: 1,
          userId: event.data.userId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        return { task: USER_SYNC_TASK, payload, spec: userSyncSpec(payload.userId) };
      },
    })),
    ...[...organizationEventDefinitions, ...billingEventDefinitions].map(
      (definition): EventRoute<OrganizationEvent | BillingEvent> => ({
        definition,
        job(event) {
          if (event.subjectId !== event.data.organizationId)
            throw new Error("Invalid CRM organization subject.");
          const payload = organizationSyncPayload.parse({
            version: 1,
            kind: "organization",
            organizationId: event.data.organizationId,
            eventId: event.id,
            eventType: event.type,
            occurredAt: event.occurredAt,
          });
          return {
            task: ORGANIZATION_SYNC_TASK,
            payload,
            spec: relatedSyncSpec(payload.organizationId),
          };
        },
      }),
    ),
    ...membershipEventDefinitions.map((definition): EventRoute<MembershipEvent> => ({
      definition,
      job(event) {
        if (event.subjectId !== event.data.membershipId)
          throw new Error("Invalid CRM membership subject.");
        // The pair, not membership row identity or domain, is authoritative.
        const payload = membershipSyncPayload.parse({
          version: 1,
          kind: "membership",
          organizationId: event.data.organizationId,
          userId: event.data.userId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        return {
          task: MEMBERSHIP_SYNC_TASK,
          payload,
          spec: relatedSyncSpec(payload.organizationId, payload.userId),
        };
      },
    })),
  ];
}
