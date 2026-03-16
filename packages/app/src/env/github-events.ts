import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

function trim(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export const githubEventsEnv = createEnv({
  isServer: true,
  server: {
    INGRESS_SOURCE: z.preprocess(trim, z.string().min(1)),
    INGRESS_COLLECTOR_URL: z.preprocess(trim, z.url()),
    CDEVENTS_CLICKHOUSE_URL: z.preprocess(trim, z.url()),
    CDEVENTS_CLICKHOUSE_USERNAME: z.preprocess(trim, z.string().min(1)),
    CDEVENTS_CLICKHOUSE_PASSWORD: z.preprocess(trim, z.string().min(1)),
    CDEVENTS_CLICKHOUSE_DATABASE: z.preprocess(trim, z.string().min(1)),
  },
  runtimeEnv: {
    INGRESS_SOURCE: process.env.INGRESS_SOURCE,
    INGRESS_COLLECTOR_URL: process.env.INGRESS_COLLECTOR_URL,
    CDEVENTS_CLICKHOUSE_URL: process.env.CDEVENTS_CLICKHOUSE_URL,
    CDEVENTS_CLICKHOUSE_USERNAME: process.env.CDEVENTS_CLICKHOUSE_USERNAME,
    CDEVENTS_CLICKHOUSE_PASSWORD: process.env.CDEVENTS_CLICKHOUSE_PASSWORD,
    CDEVENTS_CLICKHOUSE_DATABASE: process.env.CDEVENTS_CLICKHOUSE_DATABASE,
  },
  emptyStringAsUndefined: true,
});
