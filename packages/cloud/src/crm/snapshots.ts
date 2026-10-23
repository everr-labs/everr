import type { Database } from "@everr/app/db/database";
import { member, organization, user } from "@everr/app/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { readOrgEntitlement, type OrgEntitlement } from "../billing-data.server";
import { isOrganizationProvisioned } from "../organization-provisioning/metadata";
import { organizationMilestones } from "../db/schema/organization-milestones";

export type ProjectionKind = "user" | "organization" | "membership";
export type ProjectionIdentity = { sourceId: string; externalId: string } & (
  | { kind: "user"; userId: string; organizationId: null }
  | { kind: "organization"; userId: null; organizationId: string }
  | { kind: "membership"; userId: string; organizationId: string }
);

type ProjectionSource =
  | { kind: "user" | "organization"; id: string }
  | { kind: "membership"; userId: string; organizationId: string };

/** Versioned, unambiguous IDs: no email, name, slug or deployment hostname. */
export function projectionIdentity(
  deployment: string,
  source: { kind: "user"; id: string },
): Extract<ProjectionIdentity, { kind: "user" }>;
export function projectionIdentity(
  deployment: string,
  source: { kind: "organization"; id: string },
): Extract<ProjectionIdentity, { kind: "organization" }>;
export function projectionIdentity(
  deployment: string,
  source: { kind: "membership"; userId: string; organizationId: string },
): Extract<ProjectionIdentity, { kind: "membership" }>;
export function projectionIdentity(
  deployment: string,
  source: ProjectionSource,
): ProjectionIdentity;
export function projectionIdentity(
  deployment: string,
  source: ProjectionSource,
): ProjectionIdentity {
  if (!deployment.trim()) throw new Error("CRM deployment namespace is required.");
  const sourceId =
    source.kind === "membership"
      ? JSON.stringify([source.userId, source.organizationId])
      : source.id;
  const externalId = `everr:v1:${encodeURIComponent(deployment)}:${source.kind}:${encodeURIComponent(sourceId)}`;
  if (source.kind === "membership")
    return {
      kind: source.kind,
      sourceId,
      externalId,
      userId: source.userId,
      organizationId: source.organizationId,
    };
  if (source.kind === "user")
    return { kind: source.kind, sourceId, externalId, userId: source.id, organizationId: null };
  return { kind: source.kind, sourceId, externalId, userId: null, organizationId: source.id };
}

type MembershipSnapshot = { id: string; userId: string; organizationId: string; role: string };
export type DesiredProjection = ProjectionIdentity &
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
        fields: {
          name: string;
          createdAt: string;
          plan: OrgEntitlement["plan"];
          appState: OrgEntitlement["appState"];
          subscriptionStatus: string | null;
          currentPeriodEnd: string | null;
          cancelAtPeriodEnd: boolean;
          provisioning: "ready" | "pending";
          firstQueryableAt?: string | null;
          activatedAt?: string | null;
          activationRuleVersion?: number | null;
        };
        memberships: MembershipSnapshot[];
      }
    | { deleted: false; kind: "membership" }
  );

/** No event payload values enter a snapshot. Each read has one committed DB view. */
export function createCrmSnapshotReader(database: Database, deployment: string) {
  return {
    user(id: string): Promise<DesiredProjection> {
      return database.transaction(
        async (tx) => {
          const identity = projectionIdentity(deployment, { kind: "user", id });
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
    organization(id: string): Promise<DesiredProjection> {
      return database.transaction(
        async (tx) => {
          const identity = projectionIdentity(deployment, { kind: "organization", id });
          const [row] = await tx.select().from(organization).where(eq(organization.id, id));
          if (!row) return { ...identity, deleted: true };
          const entitlement = await readOrgEntitlement(id, tx);
          const [milestones] = await tx
            .select()
            .from(organizationMilestones)
            .where(eq(organizationMilestones.organizationId, id));
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
            fields: {
              name: row.name,
              createdAt: row.createdAt.toISOString(),
              plan: entitlement.plan,
              appState: entitlement.appState,
              subscriptionStatus: entitlement.status,
              currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
              provisioning: isOrganizationProvisioned(row.metadata) ? "ready" : "pending",
              firstQueryableAt: milestones?.firstQueryableAt.toISOString() ?? null,
              activatedAt: milestones?.activatedAt.toISOString() ?? null,
              activationRuleVersion: milestones?.ruleVersion ?? null,
            },
            memberships,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    membership(userId: string, organizationId: string): Promise<DesiredProjection> {
      const identity = projectionIdentity(deployment, {
        kind: "membership",
        userId,
        organizationId,
      });
      return database
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1)
        .then((rows) => ({ ...identity, kind: "membership", deleted: rows.length === 0 }));
    },
  };
}
