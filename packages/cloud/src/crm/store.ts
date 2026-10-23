import { createHash } from "node:crypto";
import type { Database } from "@everr/app/db/database";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { CompanyRecord } from "./brevo/adapter";
import { crmProjection } from "../db/schema/crm";
import {
  projectionIdentity,
  type DesiredProjection,
  type ProjectionIdentity,
  type ProjectionKind,
} from "./snapshots";

type ProjectionKey = { kind: ProjectionKind; sourceId: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Field order does not cause writes; ordered membership arrays come from the reader. */
export function snapshotFingerprint(snapshot: DesiredProjection) {
  return createHash("sha256").update(canonical(snapshot)).digest("hex");
}

export function createCrmProjectionStore(database: Database, deployment: string) {
  if (!deployment.trim()) throw new Error("CRM deployment namespace is required.");
  const where = (key: ProjectionKey) =>
    and(
      eq(crmProjection.deployment, deployment),
      eq(crmProjection.kind, key.kind),
      eq(crmProjection.sourceId, key.sourceId),
    );
  const read = async (key: ProjectionKey) => {
    const [row] = await database.select().from(crmProjection).where(where(key));
    return row;
  };
  return {
    read,
    async memberships(parent: { userId: string } | { organizationId: string }) {
      return database
        .select()
        .from(crmProjection)
        .where(
          and(
            eq(crmProjection.deployment, deployment),
            eq(crmProjection.kind, "membership"),
            "userId" in parent
              ? eq(crmProjection.userId, parent.userId)
              : eq(crmProjection.organizationId, parent.organizationId),
          ),
        );
    },
    /** Keyset page for bounded orphan checks. Never deletes or mutates source rows. */
    async page(after?: ProjectionKey, limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid CRM reconciliation page size.");
      return database
        .select()
        .from(crmProjection)
        .where(
          and(
            eq(crmProjection.deployment, deployment),
            after
              ? or(
                  gt(crmProjection.kind, after.kind),
                  and(
                    eq(crmProjection.kind, after.kind),
                    gt(crmProjection.sourceId, after.sourceId),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(crmProjection.kind), asc(crmProjection.sourceId))
        .limit(limit);
    },
    /** A repair command opens one cleanup revision only from the completed revision
     * it observed. Replayed/duplicated commands cannot repeatedly reset its allowance.
     */
    async recheckDeletion(key: ProjectionKey, completedRevision: number) {
      const [row] = await database
        .update(crmProjection)
        .set({
          desiredRevision: sql`${crmProjection.desiredRevision} + 1`,
          retryFailures: 0,
          cleanupCompanyRead: null,
          outcome: "pending",
          lastErrorCode: null,
          lastErrorAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            where(key),
            isNotNull(crmProjection.deletedAt),
            eq(crmProjection.desiredRevision, completedRevision),
            eq(crmProjection.syncedRevision, completedRevision),
          ),
        )
        .returning();
      return row;
    },
    async cleanupCompanyRead(key: ProjectionKey, current: CompanyRecord | null) {
      await database
        .update(crmProjection)
        .set({ cleanupCompanyRead: current, updatedAt: new Date() })
        .where(where(key));
    },
    async companyRead(sourceId: string, current: CompanyRecord | null) {
      await database
        .update(crmProjection)
        .set({ companyRead: current, updatedAt: new Date() })
        .where(where({ kind: "organization", sourceId }));
    },
    async companyCreateIntent(sourceId: string, revision: number) {
      const rows = await database
        .update(crmProjection)
        .set({ companyCreateAttemptedAt: new Date() })
        .where(
          and(
            where({ kind: "organization", sourceId }),
            eq(crmProjection.desiredRevision, revision),
            isNull(crmProjection.remoteId),
            isNull(crmProjection.deletedAt),
            isNull(crmProjection.companyCreateAttemptedAt),
          ),
        )
        .returning();
      return rows.length === 1;
    },
    async refundCompanyCreateIntent(sourceId: string) {
      await database
        .update(crmProjection)
        .set({ companyCreateAttemptedAt: null })
        .where(and(where({ kind: "organization", sourceId }), isNull(crmProjection.remoteId)));
    },
    /** Call with the latest reader result under the synchronization lock (task 07). */
    async desire(snapshot: DesiredProjection) {
      const expected: ProjectionIdentity =
        snapshot.kind === "membership"
          ? projectionIdentity(deployment, {
              kind: "membership",
              userId: snapshot.userId,
              organizationId: snapshot.organizationId,
            })
          : projectionIdentity(deployment, { kind: snapshot.kind, id: snapshot.sourceId });
      if (
        snapshot.sourceId !== expected.sourceId ||
        snapshot.externalId !== expected.externalId ||
        snapshot.userId !== expected.userId ||
        snapshot.organizationId !== expected.organizationId
      )
        throw new Error("CRM snapshot identity mismatch.");
      const fingerprint = snapshotFingerprint(snapshot);
      const now = new Date();
      await database
        .insert(crmProjection)
        .values({
          deployment,
          ...expected,
          desired: snapshot,
          desiredFingerprint: fingerprint,
          deletedAt: snapshot.deleted ? now : null,
        })
        .onConflictDoUpdate({
          target: [crmProjection.deployment, crmProjection.kind, crmProjection.sourceId],
          set: {
            desired: snapshot,
            desiredFingerprint: fingerprint,
            desiredRevision: sql`${crmProjection.desiredRevision} + 1`,
            retryFailures: 0,
            cleanupCompanyRead: null,
            outcome: "pending",
            deletedAt: snapshot.deleted ? sql`coalesce(${crmProjection.deletedAt}, ${now})` : null,
            lastErrorCode: null,
            lastErrorAt: null,
            updatedAt: now,
          },
          // Entity deletion is terminal. Associations can be added again after removal.
          setWhere: and(
            sql`${crmProjection.desiredFingerprint} <> ${fingerprint}`,
            snapshot.deleted || snapshot.kind === "membership"
              ? undefined
              : isNull(crmProjection.deletedAt),
          ),
        });
      const saved = await read(expected);
      if (!saved) throw new Error("CRM projection was not saved.");
      return saved;
    },
    /** Reserve before HTTP, or refund a known deferral, under the entity execution lock.
     * Both guards prevent a stale refund from restoring a newer revision's allowance.
     */
    async setRetryFailures(key: ProjectionKey, revision: number, expected: number, next: number) {
      if (![expected, next].every((value) => Number.isInteger(value) && value >= 0))
        throw new Error("Invalid CRM retry allowance.");
      const rows = await database
        .update(crmProjection)
        .set({ retryFailures: next, updatedAt: new Date() })
        .where(
          and(
            where(key),
            eq(crmProjection.desiredRevision, revision),
            eq(crmProjection.retryFailures, expected),
            sql`${crmProjection.syncedRevision} is distinct from ${revision}`,
          ),
        )
        .returning();
      return rows.length === 1;
    },
    /** Bind uncertain/old create results before recording completion, even if desired advanced. */
    async bindRemote(
      key: ProjectionKey,
      ids: { remoteId?: string; remoteContactId?: string; remoteCompanyId?: string },
    ) {
      const values = Object.values(ids);
      if (!values.length || values.some((id) => !id))
        throw new Error("CRM remote IDs are required.");
      if (
        key.kind === "membership" ? !!ids.remoteId : !!(ids.remoteContactId || ids.remoteCompanyId)
      )
        throw new Error("CRM remote ID kind mismatch.");
      const rows = await database
        .update(crmProjection)
        .set({ ...ids, updatedAt: new Date() })
        .where(
          and(
            where(key),
            ids.remoteId === undefined
              ? undefined
              : or(isNull(crmProjection.remoteId), eq(crmProjection.remoteId, ids.remoteId)),
            ids.remoteContactId === undefined
              ? undefined
              : or(
                  isNull(crmProjection.remoteContactId),
                  eq(crmProjection.remoteContactId, ids.remoteContactId),
                ),
            ids.remoteCompanyId === undefined
              ? undefined
              : or(
                  isNull(crmProjection.remoteCompanyId),
                  eq(crmProjection.remoteCompanyId, ids.remoteCompanyId),
                ),
          ),
        )
        .returning();
      if (!rows.length) throw new Error("CRM mapping missing or remote identity conflict.");
      return rows[0];
    },
    async markSynced(key: ProjectionKey, revision: number) {
      const rows = await database
        .update(crmProjection)
        .set({
          syncedRevision: revision,
          retryFailures: 0,
          syncedFingerprint: sql`${crmProjection.desiredFingerprint}`,
          outcome: "synced",
          lastSuccessAt: new Date(),
          lastErrorCode: null,
          lastErrorAt: null,
          updatedAt: new Date(),
        })
        .where(and(where(key), eq(crmProjection.desiredRevision, revision)))
        .returning();
      return rows.length === 1;
    },
    /** A bounded diagnostic code, never contact data, provider response text or secrets. */
    async markFailed(key: ProjectionKey, revision: number, code: string, blocked = false) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) throw new Error("Invalid CRM failure code.");
      const rows = await database
        .update(crmProjection)
        .set({
          outcome: blocked ? "blocked" : "failed",
          lastErrorCode: code,
          lastErrorAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            where(key),
            eq(crmProjection.desiredRevision, revision),
            sql`${crmProjection.syncedRevision} is distinct from ${revision}`,
          ),
        )
        .returning();
      return rows.length === 1;
    },
  };
}
