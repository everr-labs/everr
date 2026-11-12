import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

// Startup applies the ClickHouse schema only when the migration user is set.
// The other users' passwords become parameters of the access-setup migrations.
export const clickhouseMigrationEnv = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    CLICKHOUSE_MIGRATION_USERNAME: z.string().default("default"),
    CLICKHOUSE_MIGRATION_PASSWORD: z.string().optional(),
    CLICKHOUSE_COLLECTOR_PASSWORD: z.string().optional(),
  },
  runtimeEnv: {
    CLICKHOUSE_MIGRATION_USERNAME: process.env.CLICKHOUSE_MIGRATION_USERNAME,
    CLICKHOUSE_MIGRATION_PASSWORD: process.env.CLICKHOUSE_MIGRATION_PASSWORD,
    CLICKHOUSE_COLLECTOR_PASSWORD: process.env.CLICKHOUSE_COLLECTOR_PASSWORD,
  },
  emptyStringAsUndefined: true,
});
