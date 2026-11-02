import { readCompanyId } from "./metadata";
import type { Database } from "@everr/app/db/database";
import { member, organization, user } from "@everr/app/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import { readOrgEntitlement, type OrgEntitlement } from "../billing-data.server";
import { isOrganizationProvisioned } from "../organization-provisioning/metadata";

export function externalIdentity(kind: "user" | "organization", id: string): string {
  return `everr:v1:${kind}:${encodeURIComponent(id)}`;
}

export function sourceIdentity(
  kind: "user" | "organization",
  externalId: string | undefined,
): string | undefined {
  const prefix = `everr:v1:${kind}:`;
  if (!externalId?.startsWith(prefix)) return;
  try {
    const id = decodeURIComponent(externalId.slice(prefix.length));
    return id && externalIdentity(kind, id) === externalId ? id : undefined;
  } catch {
    return;
  }
}

type SourceIdentity = { sourceId: string; externalId: string } & (
  | { kind: "user"; userId: string; organizationId: null }
  | { kind: "organization"; userId: null; organizationId: string }
);
function entityIdentity(kind: "user", id: string): Extract<SourceIdentity, { kind: "user" }>;
function entityIdentity(
  kind: "organization",
  id: string,
): Extract<SourceIdentity, { kind: "organization" }>;
function entityIdentity(kind: "user" | "organization", id: string): SourceIdentity {
  const common = { sourceId: id, externalId: externalIdentity(kind, id) };
  return kind === "user"
    ? { ...common, kind, userId: id, organizationId: null }
    : { ...common, kind, userId: null, organizationId: id };
}

type MembershipSnapshot = { id: string; userId: string; organizationId: string; role: string };
export type SourceSnapshot = SourceIdentity &
  (
    | { deleted: true }
    | {
        deleted: false;
        kind: "user";
        fields: { name: string; email: string; registeredAt: string; emailVerified: boolean };
        memberships: MembershipSnapshot[];
      }
    | {
        deleted: false;
        kind: "organization";
        companyId?: string;
        fields: {
          name: string;
          createdAt: string;
          plan: OrgEntitlement["plan"];
          appState: OrgEntitlement["appState"];
          subscriptionStatus: string | null;
          currentPeriodEnd: string | null;
          cancelAtPeriodEnd: boolean;
          provisioning: "ready" | "pending";
        };
        memberships: MembershipSnapshot[];
      }
  );

/** No event payload values enter a snapshot. Each read has one committed DB view. */
export function createCrmSnapshotReader(database: Database) {
  return {
    user(id: string): Promise<SourceSnapshot> {
      return database.transaction(
        async (tx) => {
          const identity = entityIdentity("user", id);
          const [row] = await tx.select().from(user).where(eq(user.id, id));
          if (!row) return { ...identity, deleted: true };
          const memberships = await tx
            .select({
              id: member.id,
              userId: member.userId,
              organizationId: member.organizationId,
              role: member.role,
            })
            .from(member)
            .where(eq(member.userId, id))
            .orderBy(asc(member.id));
          return {
            ...identity,
            kind: "user",
            deleted: false,
            fields: {
              name: row.name,
              email: row.email,
              registeredAt: row.createdAt.toISOString(),
              emailVerified: row.emailVerified,
            },
            memberships,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    organization(id: string): Promise<SourceSnapshot> {
      return database.transaction(
        async (tx) => {
          const identity = entityIdentity("organization", id);
          const [row] = await tx.select().from(organization).where(eq(organization.id, id));
          if (!row) return { ...identity, deleted: true };
          const entitlement = await readOrgEntitlement(id, tx);
          const memberships = await tx
            .select({
              id: member.id,
              userId: member.userId,
              organizationId: member.organizationId,
              role: member.role,
            })
            .from(member)
            .where(eq(member.organizationId, id))
            .orderBy(asc(member.id));
          return {
            ...identity,
            kind: "organization",
            deleted: false,
            companyId: readCompanyId(row.metadata),
            fields: {
              name: row.name,
              createdAt: row.createdAt.toISOString(),
              plan: entitlement.plan,
              appState: entitlement.appState,
              subscriptionStatus: entitlement.status,
              currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
              provisioning: isOrganizationProvisioned(row.metadata) ? "ready" : "pending",
            },
            memberships,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async membership(userId: string, organizationId: string): Promise<boolean> {
      const rows = await database
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1);
      return rows.length > 0;
    },
    async *sources() {
      for (const kind of ["user", "organization"] as const) {
        const table = kind === "user" ? user : organization;
        let cursor: string | undefined;
        while (true) {
          const rows = await database
            .select({ id: table.id })
            .from(table)
            .where(cursor === undefined ? undefined : gt(table.id, cursor))
            .orderBy(asc(table.id))
            .limit(100);
          for (const row of rows) yield { kind, id: row.id };
          if (rows.length < 100) break;
          cursor = rows.at(-1)?.id;
        }
      }
    },
  };
}
