import type { EverrSession } from "./auth";
import { type ClickhouseQuery, createClickhouseQuery } from "./clickhouse";

export type AuthContext = {
  session: EverrSession;
  clickhouse: {
    query: ClickhouseQuery;
  };
};

export function createAuthContext(session: EverrSession): AuthContext {
  return {
    session,
    clickhouse: {
      query: createClickhouseQuery(session.tenantId),
    },
  };
}
