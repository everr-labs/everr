import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const durationUnits = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

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

function positiveIntegerEnv() {
  return z.preprocess((value) => {
    const normalized = trimEnvValue(value);
    if (typeof normalized !== "string" || !/^\d+$/.test(normalized)) {
      return Number.NaN;
    }

    return Number.parseInt(normalized, 10);
  }, z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
}

function durationEnv() {
  return z.preprocess((value) => {
    const normalized = trimEnvValue(value);
    if (typeof normalized !== "string") {
      return Number.NaN;
    }

    const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      return Number.NaN;
    }

    const amount = Number.parseInt(match[1], 10);
    const unit = match[2] as keyof typeof durationUnits;

    return amount * durationUnits[unit];
  }, z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
}

export const githubEventsEnv = createEnv({
  isServer: true,
  server: {
    INGRESS_SOURCE: stringEnv(),
    INGRESS_COLLECTOR_URL: urlEnv(),
    INGRESS_WORKER_COUNT: positiveIntegerEnv(),
    INGRESS_WORKER_BATCH_SIZE: positiveIntegerEnv(),
    INGRESS_MAX_ATTEMPTS: positiveIntegerEnv(),
    INGRESS_POLL_INTERVAL: durationEnv(),
    INGRESS_LOCK_DURATION: durationEnv(),
    INGRESS_REPLAY_TIMEOUT: durationEnv(),
    INGRESS_TENANT_CACHE_TTL: durationEnv(),
    INGRESS_RETENTION_DONE_DAYS: positiveIntegerEnv(),
    INGRESS_RETENTION_DEAD_DAYS: positiveIntegerEnv(),
    INGRESS_CLEANUP_INTERVAL: durationEnv(),
    CDEVENTS_CLICKHOUSE_URL: urlEnv(),
    CDEVENTS_CLICKHOUSE_USERNAME: stringEnv(),
    CDEVENTS_CLICKHOUSE_PASSWORD: stringEnv(),
    CDEVENTS_CLICKHOUSE_DATABASE: stringEnv(),
    CDEVENTS_BATCH_SIZE: positiveIntegerEnv(),
    CDEVENTS_FLUSH_INTERVAL: durationEnv(),
  },
  runtimeEnv: {
    INGRESS_SOURCE: process.env.INGRESS_SOURCE,
    INGRESS_COLLECTOR_URL: process.env.INGRESS_COLLECTOR_URL,
    INGRESS_WORKER_COUNT: process.env.INGRESS_WORKER_COUNT,
    INGRESS_WORKER_BATCH_SIZE: process.env.INGRESS_WORKER_BATCH_SIZE,
    INGRESS_MAX_ATTEMPTS: process.env.INGRESS_MAX_ATTEMPTS,
    INGRESS_POLL_INTERVAL: process.env.INGRESS_POLL_INTERVAL,
    INGRESS_LOCK_DURATION: process.env.INGRESS_LOCK_DURATION,
    INGRESS_REPLAY_TIMEOUT: process.env.INGRESS_REPLAY_TIMEOUT,
    INGRESS_TENANT_CACHE_TTL: process.env.INGRESS_TENANT_CACHE_TTL,
    INGRESS_RETENTION_DONE_DAYS: process.env.INGRESS_RETENTION_DONE_DAYS,
    INGRESS_RETENTION_DEAD_DAYS: process.env.INGRESS_RETENTION_DEAD_DAYS,
    INGRESS_CLEANUP_INTERVAL: process.env.INGRESS_CLEANUP_INTERVAL,
    CDEVENTS_CLICKHOUSE_URL: process.env.CDEVENTS_CLICKHOUSE_URL,
    CDEVENTS_CLICKHOUSE_USERNAME: process.env.CDEVENTS_CLICKHOUSE_USERNAME,
    CDEVENTS_CLICKHOUSE_PASSWORD: process.env.CDEVENTS_CLICKHOUSE_PASSWORD,
    CDEVENTS_CLICKHOUSE_DATABASE: process.env.CDEVENTS_CLICKHOUSE_DATABASE,
    CDEVENTS_BATCH_SIZE: process.env.CDEVENTS_BATCH_SIZE,
    CDEVENTS_FLUSH_INTERVAL: process.env.CDEVENTS_FLUSH_INTERVAL,
  },
  emptyStringAsUndefined: true,
});
