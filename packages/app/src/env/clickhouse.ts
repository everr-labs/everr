import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clickhouseEnv = createEnv({
  server: {
    CLICKHOUSE_URL: z.url(),
    CLICKHOUSE_USERNAME: z.string().default("default"),
    CLICKHOUSE_PASSWORD: z.string().default(""),
    CLICKHOUSE_DATABASE: z.string().default("default"),
  },
  runtimeEnv: {
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
  },
});
