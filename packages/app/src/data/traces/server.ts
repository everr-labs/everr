import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { TracesRepository } from "./repository";
import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
} from "./schemas";

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    new TracesRepository(clickhouse.query).search(data),
  );

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    new TracesRepository(clickhouse.query).getTrace(data),
  );

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    new TracesRepository(clickhouse.query).listServiceIdentities(data),
  );
