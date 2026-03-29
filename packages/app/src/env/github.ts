import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const githubEnv = createEnv({
  server: {
    GITHUB_APP_INSTALL_URL: z.url(),
    GITHUB_APP_STATE_SECRET: z.string().min(32),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(32),
    GITHUB_APP_ID: z.coerce.number().int().positive(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  },
  runtimeEnv: {
    GITHUB_APP_INSTALL_URL: process.env.GITHUB_APP_INSTALL_URL,
    GITHUB_APP_STATE_SECRET: process.env.GITHUB_APP_STATE_SECRET,
    GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  },
});
