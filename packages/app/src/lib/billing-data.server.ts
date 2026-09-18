import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Transaction } from "@/db/client";
import { member, organization, orgSubscription } from "@/db/schema";
import {
  assertPolarProductGrantsPlan,
  planForPolarProductId,
} from "@/lib/billing/catalog.server";

export type OrganizationPlan = typeof organization.$inferSelect.plan;
export type OrganizationAppState = "hobby" | "pro" | "suspended";

type SubscriptionPlanInput = {
  polarProductId: string;
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
};

function hasRole(role: string, expected: string) {
  return role.split(",").includes(expected);
}

function appStateForPlan(
  plan: OrganizationPlan,
  subscription: SubscriptionPlanInput | undefined,
): OrganizationAppState {
  if (subscription) {
    if (plan === "hobby") {
      planForPolarProductId(subscription.polarProductId);
    } else {
      assertPolarProductGrantsPlan(subscription.polarProductId, plan);
    }
  }
  if (plan === "hobby") return "hobby";
  return subscription?.status === "active" ? "pro" : "suspended";
}

const storageError = z.object({
  code: z.unknown().optional(),
  cause: z.unknown().optional(),
});
const unavailableStorageCodes = new Set<unknown>(["42P01", "42703"]);
function isUnavailablePlanStorage(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const parsed = storageError.safeParse(current);
    if (!parsed.success) return false;
    if (unavailableStorageCodes.has(parsed.data.code)) return true;
    current = parsed.data.cause;
  }
  return false;
}

async function readExplicitPlan(orgId: string) {
  try {
    const [plan] = await db
      .select({ plan: organization.plan })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);
    return plan;
  } catch (error) {
    // Keeps reads available during a rolling deployment before the new
    // Organization columns are applied. Writes still fail closed.
    if (isUnavailablePlanStorage(error)) return undefined;
    throw error;
  }
}

export type OrgEntitlement = {
  plan: OrganizationPlan;
  appState: OrganizationAppState;
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export async function readOrgEntitlement(
  orgId: string,
): Promise<OrgEntitlement> {
  const [storedPlan, subscriptionRows] = await Promise.all([
    readExplicitPlan(orgId),
    db
      .select()
      .from(orgSubscription)
      .where(eq(orgSubscription.orgId, orgId))
      .limit(1),
  ]);
  const row = subscriptionRows[0];
  // Organizations predating the Plan column keep their active Pro access.
  const plan: OrganizationPlan =
    storedPlan?.plan ?? (row?.status === "active" ? "pro" : "hobby");
  const appState = appStateForPlan(plan, row);

  return {
    plan,
    appState,
    status: row?.status ?? null,
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
  };
}

export async function userOwnsHobbyOrganization(
  userId: string,
  excludingOrgId?: string,
) {
  try {
    const memberships = await db
      .select({ role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.userId, userId),
          eq(organization.plan, "hobby"),
          excludingOrgId
            ? ne(member.organizationId, excludingOrgId)
            : undefined,
        ),
      );
    return memberships.some(({ role }) => hasRole(role, "owner"));
  } catch (error) {
    if (!isUnavailablePlanStorage(error)) throw error;
  }

  // Fall back to Memberships during a rolling deployment before the new
  // Organization columns are available.
  const memberships = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(
      excludingOrgId
        ? and(
            eq(member.userId, userId),
            ne(member.organizationId, excludingOrgId),
          )
        : eq(member.userId, userId),
    );
  const ownedOrganizations = memberships.filter(({ role }) =>
    hasRole(role, "owner"),
  );
  const entitlements = await Promise.all(
    ownedOrganizations.map(({ organizationId }) =>
      readOrgEntitlement(organizationId),
    ),
  );
  return entitlements.some(({ plan }) => plan === "hobby");
}

export async function lockHobbyOrganizationOwnership(
  tx: Transaction,
  userId: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}
