import { loadEnv } from "vite";

const mode = process.argv[2] ?? "production";

// Match Vite's environment files while keeping shell values authoritative.
for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { pool } = await import("@/db/client");
try {
  const [
    {
      server: { migrateDatabase },
    },
    { withMigrationLock },
  ] = await Promise.all([
    import("@composition/server"),
    import("@/db/migrations"),
  ]);
  await withMigrationLock(migrateDatabase);
} finally {
  await pool.end();
}
