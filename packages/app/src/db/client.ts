import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { dbEnv } from "@/db.env";

export const pool = new Pool({
  host: dbEnv.DATABASE_HOST,
  database: dbEnv.DATABASE_NAME,
  port: dbEnv.DATABASE_PORT,
  user: dbEnv.DATABASE_USER,
  password: dbEnv.DATABASE_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
});

export const db = drizzle(pool, { schema });
