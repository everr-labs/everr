import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";

console.log("[startup] Migrating database...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[startup] Database migrated.");

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const startFetch = createStartHandler(handler);

export default {
  fetch: (...args: Parameters<typeof startFetch>) => startFetch(...args),
};
