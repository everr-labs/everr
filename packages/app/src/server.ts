import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";

function ensureAppRuntimeStarted(): Promise<void> {
  if (!import.meta.env.SSR || process.env.NODE_ENV === "test") {
    return Promise.resolve();
  }

  return import("./server/github-events/runtime").then((runtime) =>
    runtime.ensureGitHubEventsRuntimeForAppStart(),
  );
}

console.log("[startup] Migrating database...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[startup] Database migrated.");

await ensureAppRuntimeStarted();

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const fetch = createStartHandler(handler);

export default createServerEntry({ fetch });
