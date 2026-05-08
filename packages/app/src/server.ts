if (process.env.NODE_ENV === "development") {
  await import("./instrumentation");
}

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";

console.log("[startup] Migrating database...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[startup] Database migrated.");

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const fetch = createStartHandler(handler);

export default createServerEntry({ fetch });
