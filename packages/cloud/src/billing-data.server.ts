import { db } from "@everr/app/db/client";
import type { DbExecutor } from "@everr/app/db/database";
import { member } from "@everr/app/db/schema";
import { isOrganizationOwner } from "@everr/app/identity/roles";
import { and, eq, ne, sql } from "drizzle-orm";
import { assertPolarProductGrantsPlan, planForPolarProductId } from "./billing/catalog.server";
import { organizationBilling, orgSubscription } from "./db/schema";

export type OrganizationPlan = "hobby" | "pro";
export type OrganizationAppState = "hobby" | "pro" | "suspended";

type SubscriptionPlanInput = {
  polarProductId: string;
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
};

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

async function readExplicitPlan(orgId: string, database: DbExecutor) {
  const [row] = await database
    .select({ plan: organizationBilling.plan })
    .from(organizationBilling)
    .where(eq(organizationBilling.orgId, orgId))
    .limit(1);
  return row;
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
  database: DbExecutor = db,
): Promise<OrgEntitlement> {
  const [storedPlan, subscriptionRows] = await Promise.all([
    readExplicitPlan(orgId, database),
    database.select().from(orgSubscription).where(eq(orgSubscription.orgId, orgId)).limit(1),
  ]);
  const row = subscriptionRows[0];
  const plan: OrganizationPlan = storedPlan?.plan ?? "hobby";
  const appState = appStateForPlan(plan, row);

  return {
    plan,
    appState,
    status: row?.status ?? null,
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
  };
}

export async function userOwnsHobbyOrganization(userId: string, excludingOrgId?: string) {
  const memberships = await db
    .select({ role: member.role })
    .from(member)
    .leftJoin(organizationBilling, eq(organizationBilling.orgId, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        sql`coalesce(${organizationBilling.plan}, 'hobby') = 'hobby'`,
        excludingOrgId ? ne(member.organizationId, excludingOrgId) : undefined,
      ),
    );
  return memberships.some(({ role }) => isOrganizationOwner(role));
}
