import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]),
    RESEND_API_KEY: z.string(),
  },

  clientPrefix: "VITE_",

  client: {
    VITE_POSTHOG_PROJECT_TOKEN: z.string(),
    VITE_POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    VITE_POSTHOG_PROJECT_TOKEN: import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
    VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
  },

  emptyStringAsUndefined: true,
});
