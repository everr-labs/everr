import { and, eq, exists, sql } from "drizzle-orm";
import type { HomeStatus } from "@/common/onboarding";
import type { Database } from "@/db/client";
import { member, organization } from "@/db/schema";
import { isOrganizationAdmin } from "@/lib/organization-role";

interface OnboardingScope {
  organizationId: string;
  userId: string;
}

export function createOnboardingStore(
  database: Pick<Database, "select" | "update">,
) {
  // Metadata is stored as JSON text. Both SQL NULL and JSON null represent an
  // organization without metadata; malformed JSON must surface as an error.
  const metadata = sql`coalesce(nullif(nullif(${organization.metadata}, '')::jsonb, 'null'::jsonb), '{}'::jsonb)`;
  const onboardingCompleted = sql<boolean>`coalesce(${metadata} -> 'onboardingCompleted' = 'true'::jsonb, false)`;
  const membershipIdentity = (scope: OnboardingScope) =>
    and(
      eq(member.organizationId, scope.organizationId),
      eq(member.userId, scope.userId),
    );

  return {
    async getStatus(scope: OnboardingScope): Promise<HomeStatus> {
      const [row] = await database
        .select({
          role: member.role,
          onboardingCompleted,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(membershipIdentity(scope))
        .limit(1);
      if (!row)
        throw new Error("You are no longer a member of this organization.");
      return {
        canCreateKeys: isOrganizationAdmin(row.role),
        onboardingCompleted: row.onboardingCompleted,
      };
    },

    async complete(scope: OnboardingScope) {
      // Membership is checked in the same statement as the update, including
      // members without key-creation permission. The flag belongs to the org.
      const membership = database
        .select({ id: member.id })
        .from(member)
        .where(membershipIdentity(scope))
        .limit(1);
      const [row] = await database
        .update(organization)
        // Merge into the current row in SQL so unrelated metadata, including
        // changes made since Home was loaded, stays intact.
        .set({
          metadata: sql`jsonb_set(${metadata}, '{onboardingCompleted}', 'true'::jsonb)::text`,
        })
        .where(
          and(eq(organization.id, scope.organizationId), exists(membership)),
        )
        .returning({ onboardingCompleted });
      if (!row)
        throw new Error("You are no longer a member of this organization.");
      return row;
    },
  };
}
