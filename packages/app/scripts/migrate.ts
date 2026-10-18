import { loadEnv } from "vite";

const mode = process.argv[2] ?? "production";

// Match Vite's environment files while keeping shell values authoritative.
for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { pool } = await import("#app/db/client.ts");
try {
  const [
    {
      server: { migrateDatabase },
    },
    { withMigrationLock },
  ] = await Promise.all([
    import("@composition/server"),
    import("#app/db/migrations.ts"),
  ]);
  await withMigrationLock(migrateDatabase);
} finally {
  await pool.end();
}
