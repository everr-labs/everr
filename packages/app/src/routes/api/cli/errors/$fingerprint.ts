import { isValid } from "@everr/datemath";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getErrorIssue } from "@/data/errors/server";

const datemath = z.string().refine(isValid);

const ErrorShowQuerySchema = z.strictObject({
  from: datemath.optional(),
  to: datemath.optional(),
  occurrenceLimit: z.coerce.number().int().min(1).max(200).optional(),
});

export const Route = createFileRoute("/api/cli/errors/$fingerprint")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const fingerprint = params.fingerprint;
        if (!fingerprint) {
          return Response.json(
            { error: "Missing fingerprint path parameter." },
            { status: 400 },
          );
        }

        const url = new URL(request.url);
        const parsed = ErrorShowQuerySchema.safeParse(
          Object.fromEntries(url.searchParams.entries()),
        );
        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for error detail. Check occurrenceLimit and time range values.",
            },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };
        const { fromDate, toDate } = resolveTimeRange(timeRange);

        try {
          const detail = await getErrorIssue({
            data: {
              fingerprint,
              fromTs: toClickHouseDateTime(fromDate),
              toTs: toClickHouseDateTime(toDate),
              service: [],
              occurrenceLimit: parsed.data.occurrenceLimit,
            },
          });
          return Response.json(detail);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Error issue not found"
          ) {
            return Response.json(
              {
                error: `No Error with Fingerprint ${fingerprint} in the ${timeRange.from}..${timeRange.to} time range.`,
              },
              { status: 404 },
            );
          }
          throw error;
        }
      },
    },
  },
});
