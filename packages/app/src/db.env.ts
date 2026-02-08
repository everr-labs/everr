import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const dbEnv = createEnv({
  server: {
    DATABASE_URL: z.url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
  },
});
