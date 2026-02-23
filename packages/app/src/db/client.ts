import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { dbEnv } from "@/db.env";

const pool = new Pool({
  connectionString: dbEnv.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
