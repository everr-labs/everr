import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

function trim(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export const ingestEnv = createEnv({
  isServer: true,
  server: {
    INGEST_VERIFY_SHARED_SECRET: z.preprocess(trim, z.string().min(32)),
  },
  runtimeEnv: {
    INGEST_VERIFY_SHARED_SECRET: process.env.INGEST_VERIFY_SHARED_SECRET,
  },
  emptyStringAsUndefined: true,
});
