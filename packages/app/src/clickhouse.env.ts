import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clickhouseEnv = createEnv({
  server: {
    CLICKHOUSE_HOST: z.string().default("localhost"),
    CLICKHOUSE_PORT: z.coerce.number().default(8123),
    CLICKHOUSE_USERNAME: z.string().default("default"),
    CLICKHOUSE_PASSWORD: z.string().default(""),
    CLICKHOUSE_DATABASE: z.string().default("default"),
  },
  runtimeEnv: {
    CLICKHOUSE_HOST: process.env.CLICKHOUSE_HOST,
    CLICKHOUSE_PORT: process.env.CLICKHOUSE_PORT,
    CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
  },
});
