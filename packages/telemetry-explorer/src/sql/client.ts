import { z } from "zod";

// Transports return untrusted results. The repository supplies the row schema
// for its SELECT before values reach mappers or the query cache.
export interface SqlClient {
  execute(sql: string, params: Record<string, unknown>): Promise<unknown>;
}

export async function queryRows<Schema extends z.ZodType>(
  client: SqlClient,
  schema: Schema,
  sql: string,
  params: Record<string, unknown>,
): Promise<z.output<Schema>[]> {
  const response = await client.execute(sql, params);
  const parsed = z.array(schema).safeParse(response);
  if (!parsed.success) {
    throw new Error("Invalid SQL query response", { cause: parsed.error });
  }
  return parsed.data;
}
