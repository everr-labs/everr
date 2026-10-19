import type { ApplicationStorage } from "#app/composition/storage.ts";
import { appEnv } from "../env";

export const storage: ApplicationStorage = {
  appQuerySettings(_organizationId, settings) {
    return settings;
  },
  sqlApiAccess() {
    return {
      auth: {
        username: appEnv.CLICKHOUSE_SQL_API_USERNAME,
        password: appEnv.CLICKHOUSE_SQL_API_PASSWORD,
      },
    };
  },
  assertStorageReady() {},
  telemetryTenantId: () => undefined,
};
