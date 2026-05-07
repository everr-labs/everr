import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clickhouseEnv = createEnv({
  server: {
    CLICKHOUSE_URL: z.url(),
    CLICKHOUSE_USERNAME: z.string(),
    CLICKHOUSE_PASSWORD: z.string(),
    CLICKHOUSE_DATABASE: z.string(),
    CLICKHOUSE_ADMIN_USERNAME: z.string(),
    CLICKHOUSE_ADMIN_PASSWORD: z.string(),
    CLICKHOUSE_SQL_API_USERNAME: z.string(),
    CLICKHOUSE_SQL_API_PASSWORD: z.string(),
  },
  runtimeEnv: {
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
    CLICKHOUSE_ADMIN_USERNAME: process.env.CLICKHOUSE_ADMIN_USERNAME,
    CLICKHOUSE_ADMIN_PASSWORD: process.env.CLICKHOUSE_ADMIN_PASSWORD,
    CLICKHOUSE_SQL_API_USERNAME: process.env.CLICKHOUSE_SQL_API_USERNAME,
    CLICKHOUSE_SQL_API_PASSWORD: process.env.CLICKHOUSE_SQL_API_PASSWORD,
  },
});
