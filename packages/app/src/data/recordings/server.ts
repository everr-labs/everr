import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import { type SqlClient, RecordingsRepository } from "./repository";
import { GetRecordingInputSchema, ListRecordingsInputSchema } from "./schemas";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new RecordingsRepository(client);
}

export const listRecordings = createAuthenticatedServerFn({ method: "GET" })
  .validator(ListRecordingsInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).list(data));

export const getRecording = createAuthenticatedServerFn({ method: "GET" })
  .validator(GetRecordingInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).get(data));
