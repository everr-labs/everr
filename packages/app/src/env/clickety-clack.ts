import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clicketyClackEnv = createEnv({
  server: {
    // Base URL of the clickety-clack `api` role, e.g. http://localhost:8080
    CLICKETY_CLACK_BASE_URL: z.url(),
    // Static bearer key for CC's `/v1` API (one of the keys in CC's
    // `CC_API_KEYS`). Sent as `Authorization: Bearer <key>` by the transport
    // client. Optional: when unset, requests carry no Authorization header,
    // matching a CC instance with auth disabled.
    CLICKETY_CLACK_API_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    CLICKETY_CLACK_BASE_URL: process.env.CLICKETY_CLACK_BASE_URL,
    CLICKETY_CLACK_API_KEY: process.env.CLICKETY_CLACK_API_KEY,
  },
});
