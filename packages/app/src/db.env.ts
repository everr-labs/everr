import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const dbEnv = createEnv({
  server: {
    DATABASE_HOST: z.string(),
    DATABASE_NAME: z.string(),
    DATABASE_PORT: z.coerce.number().int().positive(),
    DATABASE_USER: z.string(),
    DATABASE_PASSWORD: z.string(),
  },
  runtimeEnv: {
    DATABASE_HOST: process.env.DATABASE_HOST,
    DATABASE_NAME: process.env.DATABASE_NAME,
    DATABASE_PORT: process.env.DATABASE_PORT,
    DATABASE_USER: process.env.DATABASE_USER,
    DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
  },
});
