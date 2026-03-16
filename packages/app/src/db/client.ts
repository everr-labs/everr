import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { dbEnv } from "@/env/db";

const shouldUseSsl = ["true", "1", "yes", "on"].includes(
  dbEnv.DATABASE_SSL?.toLowerCase() ?? "",
);

export const pool = new Pool({
  host: dbEnv.DATABASE_HOST,
  database: dbEnv.DATABASE_NAME,
  port: dbEnv.DATABASE_PORT,
  user: dbEnv.DATABASE_USER,
  password: dbEnv.DATABASE_PASSWORD,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
