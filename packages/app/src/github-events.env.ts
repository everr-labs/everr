import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

function trimEnvValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function stringEnv() {
  return z.preprocess(trimEnvValue, z.string().min(1));
}

function urlEnv() {
  return z.preprocess(trimEnvValue, z.url());
}

export const githubEventsEnv = createEnv({
  isServer: true,
  server: {
    INGRESS_SOURCE: stringEnv(),
    INGRESS_COLLECTOR_URL: urlEnv(),
    CDEVENTS_CLICKHOUSE_URL: urlEnv(),
    CDEVENTS_CLICKHOUSE_USERNAME: stringEnv(),
    CDEVENTS_CLICKHOUSE_PASSWORD: stringEnv(),
    CDEVENTS_CLICKHOUSE_DATABASE: stringEnv(),
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
