import { loadEnv } from "vite";

const mode = process.argv[2];
if (mode !== "self-hosted" && mode !== "cloud") {
  throw new Error("Usage: tsx scripts/migrate.ts <self-hosted|cloud>");
}

// Match Vite's product-specific env files while keeping shell values authoritative.
for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { pool } = await import("@/db/client");
try {
  const [{ migrateDatabase }, { withMigrationLock }] = await Promise.all([
    import("@app/migrations"),
    import("@/db/migrations"),
  ]);
  await withMigrationLock(migrateDatabase);
} finally {
  await pool.end();
}
