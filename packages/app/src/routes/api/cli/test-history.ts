import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getTestHistory } from "@/data/flaky-tests";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const TestHistoryQuerySchema = z.object({
  repo: z.string().min(1),
  testFullName: z.string().min(1).optional(),
  testModule: z.string().min(1).optional(),
  testName: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const Route = createFileRoute("/api/cli/test-history")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = TestHistoryQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          testFullName: url.searchParams.get("testFullName") ?? undefined,
          testModule: url.searchParams.get("testModule") ?? undefined,
          testName: url.searchParams.get("testName") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo and at least one of testModule/testName/testFullName. Optional: from, to, limit, offset.",
            },
            { status: 400 },
          );
        }

        const {
          repo,
          testFullName,
          testModule,
          testName,
          from,
          to,
          limit = 100,
          offset = 0,
        } = parsed.data;
        if (!testModule && !testName && !testFullName) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Provide at least one of testModule, testName, or testFullName.",
            },
            { status: 400 },
          );
        }

        const result = await getTestHistory({
          data: {
            repo,
            testFullName,
            testModule,
            testName,
            limit,
            offset,
            timeRange: {
              from: from ?? DEFAULT_TIME_RANGE.from,
              to: to ?? DEFAULT_TIME_RANGE.to,
            },
          },
        });

        return Response.json(result);
      },
    },
  },
});
