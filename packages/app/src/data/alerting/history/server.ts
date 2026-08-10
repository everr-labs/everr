import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { getPreviewScopes } from "@/data/previews/repoids";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { alertingOrganizationId } from "../session";
import { queryClickHouseAlertEventLog } from "./repository.server";

export const listAlertingEventHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(200),
      timeRange: TimeRangeSchema,
      fingerprint: z.string().min(1).optional(),
      sourceId: z.string().min(1).optional(),
      slugs: z.array(z.string().min(1)).min(1).optional(),
      // Per-rule callers pass the rule's own repoid, so the read hits the
      // sort key's (tenant_id, repoid, slug, ...) prefix; org-wide history
      // leaves it unset on purpose.
      repoid: z.string().min(1).optional(),
      preview: z.string().optional(),
    }),
  )
  .handler(
    async ({
      data: { limit, timeRange, fingerprint, sourceId, slugs, repoid, preview },
      context: { session },
    }) => {
      const { fromDate, toDate } = resolveTimeRange(timeRange);
      const org = alertingOrganizationId(session);
      const previewName = preview?.trim() || null;
      const previewIds =
        previewName === null
          ? null
          : (await getPreviewScopes(org, previewName)).map((scope) => scope.id);
      return queryClickHouseAlertEventLog(org, {
        limit,
        from: fromDate,
        to: toDate,
        previewIds,
        ...(fingerprint !== undefined ? { fingerprint } : {}),
        ...(sourceId !== undefined ? { sourceId } : {}),
        ...(slugs !== undefined ? { slugs } : {}),
        ...(repoid !== undefined ? { repoid } : {}),
      });
    },
  );
