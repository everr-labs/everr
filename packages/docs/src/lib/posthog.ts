import * as ph from "posthog-js";
import { env } from "@/env";

export const posthog = ph.posthog.init(env.VITE_POSTHOG_PROJECT_TOKEN, {
  api_host: env.VITE_POSTHOG_HOST,
  defaults: "2026-01-30",
  debug: import.meta.env.DEV,
  cookieless_mode: "always",
});
