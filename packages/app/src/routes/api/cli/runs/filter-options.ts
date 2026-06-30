import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunFilterOptions } from "@/data/runs-list/server";

const RunFilterOptionsQuerySchema = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/api/cli/runs/filter-options")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = RunFilterOptionsQuerySchema.safeParse(
          Object.fromEntries(url.searchParams.entries()),
        );

        if (!parsed.success) {
          return Response.json(
            { error: "Invalid query parameters for runs filter options." },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };

        const result = await getRunFilterOptions({
          data: { timeRange },
        });

        return Response.json(result);
      },
    },
  },
});
