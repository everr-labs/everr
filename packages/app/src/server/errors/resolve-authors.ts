import type { ErrorTriageEvent } from "@everr/telemetry-explorer/errors";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";

// The triage table stores author ids only; display names resolve from the
// user profile here, so renames and account erasure never require a row
// change. Server-only module: it must stay out of client import graphs
// (reach it via dynamic import from server function handlers).
export async function resolveAuthors(
  events: ErrorTriageEvent[],
): Promise<ErrorTriageEvent[]> {
  const ids = [...new Set(events.map((e) => e.author.id).filter(Boolean))];
  if (ids.length === 0) return events;
  const authors = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, ids));
  const nameById = new Map(authors.map((a) => [a.id, a.name || a.email]));
  return events.map((event) => ({
    ...event,
    author: {
      ...event.author,
      name: nameById.get(event.author.id) ?? "",
    },
  }));
}
