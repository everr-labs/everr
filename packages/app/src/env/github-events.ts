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
  skipValidation: !!process.env.BUILD,
  server: {
    INGRESS_SOURCE: z.preprocess(trim, z.string().min(1)),
    INGRESS_COLLECTOR_URL: z.preprocess(trim, z.url()),
  },
  runtimeEnv: {
    INGRESS_SOURCE: process.env.INGRESS_SOURCE,
    INGRESS_COLLECTOR_URL: process.env.INGRESS_COLLECTOR_URL,
  },
  emptyStringAsUndefined: true,
});
