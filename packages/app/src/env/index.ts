import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";
import { authEnv } from "./auth";
import { clickhouseEnv } from "./clickhouse";
import { dbEnv } from "./db";
import { githubEnv } from "./github";
import { githubEventsEnv } from "./github-events";

export const env = createEnv({
  extends: [dbEnv, clickhouseEnv, githubEnv, authEnv, githubEventsEnv],
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]),
    // TODO: Resend API key is required only in production, so we should make it optional in non-production environments by using createFinalSchema
    RESEND_API_KEY: z.string(),
    EMAIL_FROM: z.email(),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: "VITE_",

  client: {},

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  },

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
});
