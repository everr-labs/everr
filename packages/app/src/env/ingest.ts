import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const ingestEnv = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  isServer: true,
  server: {
    INGEST_VERIFY_SHARED_SECRET: z.string().trim().min(32),
  },
  runtimeEnv: {
    INGEST_VERIFY_SHARED_SECRET: process.env.INGEST_VERIFY_SHARED_SECRET,
  },
  emptyStringAsUndefined: true,
});
