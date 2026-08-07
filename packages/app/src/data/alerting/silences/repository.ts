import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { alertSilences } from "@/db/schema";
import { throwAlertingPersistenceError } from "../persistence";
import { AlertingSilenceInputSchema } from "../schema";
import type { AlertingSilenceInput } from "../types";

export async function listSilences(organizationId: string) {
  const rows = await db
    .select()
    .from(alertSilences)
    .where(eq(alertSilences.organizationId, organizationId))
    .orderBy(desc(alertSilences.createdAt));
  return rows.map((row) => ({
    id: row.id,
    tenant: row.organizationId,
    matchers: row.matchers,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    comment: row.comment,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function createSilence(
  organizationId: string,
  rawInput: AlertingSilenceInput,
) {
  const input = AlertingSilenceInputSchema.parse(rawInput);
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (!(endsAt > startsAt)) {
    throwAlertingPersistenceError(
      422,
      "validation",
      "silence ends_at must be after starts_at",
    );
  }
  const [row] = await db
    .insert(alertSilences)
    .values({
      organizationId,
      startsAt,
      endsAt,
      comment: input.comment ?? "",
      author: input.author ?? "",
      matchers: input.matchers,
    })
    .returning();
  return {
    id: row.id,
    tenant: row.organizationId,
    matchers: row.matchers,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    comment: row.comment,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  };
}

export async function deleteSilence(organizationId: string, id: string) {
  const rows = await db
    .delete(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        eq(alertSilences.id, id),
      ),
    )
    .returning({ id: alertSilences.id });
  return { deleted: rows.length > 0 };
}
