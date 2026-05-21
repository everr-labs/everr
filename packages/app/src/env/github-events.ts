import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const githubEventsEnv = createEnv({
  isServer: true,
  server: {
    INGRESS_SOURCE: z.string().trim().min(1),
    INGRESS_COLLECTOR_URL: z.url().trim(),
  },
  runtimeEnv: {
    INGRESS_SOURCE: process.env.INGRESS_SOURCE,
    INGRESS_COLLECTOR_URL: process.env.INGRESS_COLLECTOR_URL,
  },
  emptyStringAsUndefined: true,
});
