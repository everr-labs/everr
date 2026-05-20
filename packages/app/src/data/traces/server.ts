import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { TracesRepository } from "./repository";
import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
} from "./schemas";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  return new TracesRepository(clickhouse.query);
}

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).search(data),
  );

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).getTrace(data),
  );

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServiceIdentities(data),
  );
