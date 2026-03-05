import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const githubEnv = createEnv({
  server: {
    GITHUB_APP_INSTALL_URL: z.url(),
    GITHUB_APP_STATE_SECRET: z.string().min(32),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(32),
    INGRESS_TENANT_RESOLUTION_SECRET: z.string().min(16),
  },
  runtimeEnv: {
    GITHUB_APP_INSTALL_URL: process.env.GITHUB_APP_INSTALL_URL,
    GITHUB_APP_STATE_SECRET: process.env.GITHUB_APP_STATE_SECRET,
    GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET,
    INGRESS_TENANT_RESOLUTION_SECRET:
      process.env.INGRESS_TENANT_RESOLUTION_SECRET,
  },
});
