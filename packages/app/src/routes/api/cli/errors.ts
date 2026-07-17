import { isValid } from "@everr/datemath";
import { ErrorSortSchema } from "@everr/telemetry-explorer/errors";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { searchErrorIssues } from "@/data/errors/server";

const datemath = z.string().refine(isValid);

const ErrorsListQuerySchema = z.strictObject({
  from: datemath.optional(),
  to: datemath.optional(),
  service: z.array(z.string()).optional(),
  sort: ErrorSortSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const Route = createFileRoute("/api/cli/errors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const service = url.searchParams.getAll("service");
        const parsed = ErrorsListQuerySchema.safeParse({
          ...Object.fromEntries(url.searchParams.entries()),
          service: service.length > 0 ? service : undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for errors listing. Check service, sort, limit, and time range values.",
            },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };
        const { fromDate, toDate } = resolveTimeRange(timeRange);

        const result = await searchErrorIssues({
          data: {
            fromTs: toClickHouseDateTime(fromDate),
            toTs: toClickHouseDateTime(toDate),
            q: "",
            service: parsed.data.service ?? [],
            fingerprint: "",
            sort: parsed.data.sort ?? "lastSeen",
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            attributes: [],
          },
        });

        return Response.json({
          ...result,
          filters: {
            from: timeRange.from,
            to: timeRange.to,
            service: parsed.data.service ?? [],
            sort: parsed.data.sort ?? "lastSeen",
            limit: parsed.data.limit ?? 50,
            offset: parsed.data.offset ?? 0,
          },
        });
      },
    },
  },
});
