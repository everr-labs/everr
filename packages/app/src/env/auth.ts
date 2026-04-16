import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const authEnv = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    REQUIRE_INVITATION_FOR_SIGNUP: z.stringbool().optional().default(true),
  },
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    REQUIRE_INVITATION_FOR_SIGNUP: process.env.REQUIRE_INVITATION_FOR_SIGNUP,
  },
});
