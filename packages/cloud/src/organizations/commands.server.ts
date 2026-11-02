import { db } from "@everr/app/db/client";
import { membershipChanged } from "@everr/app/identity/events";
import { events } from "@everr/app/server/events/runtime";
import { organizationPlanChanged } from "../billing/events";
import { restrictOrganizationToOwner } from "@everr/app/identity/memberships";
import { auth } from "@everr/app/identity/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { billing } from "../billing/server";
import { readOrgEntitlement, userOwnsHobbyOrganization } from "../billing-data.server";
import { type CreateOrganizationInputSchema, generateOrgSlug } from "../common/organization-name";
import { organizationBilling } from "../db/schema";
import { lockOrganizationOwnership } from "../organization-lock.server";

class OrganizationCreationError extends Error {
  name = "OrganizationCreationError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

class HobbyOrganizationLimitError extends Error {
  name = "HobbyOrganizationLimitError";

  constructor() {
    super("You already own a Hobby organization. Create this one on Pro.");
  }
}

class HobbyDowngradeUnavailableError extends Error {
  name = "HobbyDowngradeUnavailableError";
}

/** Cloud organization changes own eligibility, lock ordering, and persistence. */
export const organizationCommands = {
  async creationOptions(actorId: string) {
    return { canCreateHobby: !(await userOwnsHobbyOrganization(actorId)) };
  },
  async create({
    actorId,
    input,
  }: {
    actorId: string;
    input: z.infer<typeof CreateOrganizationInputSchema>;
  }) {
    if (!input.plan) throw new OrganizationCreationError("Choose a cloud plan.");
    if (input.plan === "hobby") {
      return db.transaction(async (tx) => {
        await lockOrganizationOwnership(tx, actorId);
        if (await userOwnsHobbyOrganization(actorId)) {
          throw new HobbyOrganizationLimitError();
        }

        const organization = await auth.api.createOrganization({
          body: {
            name: input.organizationName,
            slug: generateOrgSlug(),
            userId: actorId,
          },
        });
        if (!organization) {
          throw new OrganizationCreationError("The organization could not be created.");
        }

        return {
          kind: "created" as const,
          organization: { id: organization.id, name: organization.name },
        };
      });
    }

    try {
      return await billing.startNewOrganizationCheckout(
        actorId,
        input.organizationName,
        input.returnTo,
      );
    } catch (error) {
      throw new OrganizationCreationError(
        "Pro checkout could not be started. Please try again.",
        error,
      );
    }
  },
  async completeCheckout({ actorId, checkoutId }: { actorId: string; checkoutId: string }) {
    return billing.completeNewOrganizationCheckout(checkoutId, actorId, (input) =>
      auth.api.createOrganization(input),
    );
  },
  async downgradeToHobby({ organizationId, actorId }: { organizationId: string; actorId: string }) {
    // Billing rechecks the actor's current Owner membership under its organization lock.
    return billing.downgrade(organizationId, actorId, async (revokeBillingAccess) => {
      const committed = await db.transaction(async (tx) => {
        // Serialize the application-level one-Hobby-per-Owner check before
        // revoking a subscription that may not be convertible to Hobby.
        await lockOrganizationOwnership(tx, actorId);
        // Billing holds the organization lock and has rechecked ownership.
        // Re-read suspension after both locks: a subscription may have
        // recovered since this request started.
        if ((await readOrgEntitlement(organizationId)).appState !== "suspended") {
          throw new HobbyDowngradeUnavailableError(
            "Only a suspended Pro organization can be downgraded.",
          );
        }
        if (await userOwnsHobbyOrganization(actorId, organizationId)) {
          throw new HobbyDowngradeUnavailableError("You already own a Hobby organization.");
        }

        await revokeBillingAccess();

        const membershipChanges = await restrictOrganizationToOwner(tx, {
          organizationId,
          ownerId: actorId,
        });
        const [changedPlan] = await tx
          .update(organizationBilling)
          .set({ plan: "hobby" })
          .where(
            and(eq(organizationBilling.orgId, organizationId), eq(organizationBilling.plan, "pro")),
          )
          .returning({ id: organizationBilling.orgId });
        return { ...membershipChanges, changedPlan: !!changedPlan };
      });
      for (const removed of committed.removedMemberships)
        await events.publish(membershipChanged("membership.removed", removed));
      if (committed.changedPlan)
        await events.publish(organizationPlanChanged(organizationId, "pro", "hobby"));
      return {
        removedMembers: committed.removedMembers,
        canceledInvitations: committed.canceledInvitations,
      };
    });
  },
};
