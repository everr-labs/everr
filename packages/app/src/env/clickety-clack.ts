import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clicketyClackEnv = createEnv({
  server: {
    // Base URL of the clickety-clack `api` role, e.g. http://localhost:8080
    CLICKETY_CLACK_BASE_URL: z.url(),
    // CC Phase 1 is header-trust only (no API key). When CC adds real auth,
    // add CLICKETY_CLACK_API_KEY here and send it from the transport client.
  },
  runtimeEnv: {
    CLICKETY_CLACK_BASE_URL: process.env.CLICKETY_CLACK_BASE_URL,
  },
});
