import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const githubEnv = createEnv({
  server: {
    GITHUB_APP_INSTALL_URL: z.url(),
    GITHUB_APP_STATE_SECRET: z.string().min(32),
  },
  runtimeEnv: {
    GITHUB_APP_INSTALL_URL: process.env.GITHUB_APP_INSTALL_URL,
    GITHUB_APP_STATE_SECRET: process.env.GITHUB_APP_STATE_SECRET,
  },
});
