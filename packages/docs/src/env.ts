import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]),
  },

  clientPrefix: "VITE_",

  client: {
    VITE_POSTHOG_PROJECT_TOKEN: z.string(),
    VITE_POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),
    VITE_EVERR_PUBLIC_INGEST_KEY: z.string().optional(),
    VITE_EVERR_INGEST_ENDPOINT: z.string().optional(),
    VITE_COMMIT_SHA: z.string().optional(),
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VITE_POSTHOG_PROJECT_TOKEN: import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
    VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
    VITE_EVERR_PUBLIC_INGEST_KEY: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
    VITE_EVERR_INGEST_ENDPOINT: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
    VITE_COMMIT_SHA: import.meta.env.VITE_COMMIT_SHA,
  },

  emptyStringAsUndefined: true,
});
