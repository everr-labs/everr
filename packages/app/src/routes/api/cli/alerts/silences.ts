import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseAlertingInput } from "@/data/alerting/persistence";
import { alertingMutationScope } from "@/data/alerting/session";
import {
  createSilence,
  listSilences,
} from "@/data/alerting/silences/repository";
import { alertingJson, readJsonBody } from "./-responses";

const DEFAULT_PAGE_SIZE = 20;

/** An absolute instant. Date math is resolved by the caller, not here. */
const QueryInstant = z
  .string()
  .datetime()
  .transform((value) => new Date(value));

const SilencesQuerySchema = z.strictObject({
  // A silence matches when its own window overlaps this one.
  from: QueryInstant.optional(),
  to: QueryInstant.optional(),
  // 101, not 100, so a caller can request one more row than it means to show
  // and learn whether another page exists without a second count query.
  limit: z.coerce.number().int().min(1).max(101).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/alerts/silences")({
  server: {
    handlers: {
      GET: ({ request, context }) =>
        alertingJson(() => {
          const url = new URL(request.url);
          const query = parseAlertingInput(
            SilencesQuerySchema,
            Object.fromEntries(url.searchParams),
          );
          return listSilences(
            context.session.session.activeOrganizationId,
            query,
          );
        }),
      // The scope carries the authenticated principal, so the stored author is
      // who the session says it is, not whoever the body names.
      POST: ({ request, context }) =>
        alertingJson(async () =>
          createSilence(
            alertingMutationScope(context.session),
            await readJsonBody(request),
          ),
        ),
    },
  },
});
