import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";
import { startGitHubEventsRuntime } from "./server/github-events/runtime";

if (!import.meta.env.SSR || process.env.NODE_ENV === "test") {
  console.log("[startup] Migrating database...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[startup] Database migrated.");

  await startGitHubEventsRuntime();
}

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const fetch = createStartHandler(handler);

export default createServerEntry({ fetch });
