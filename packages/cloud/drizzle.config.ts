import { defineConfig } from "drizzle-kit";
import appConfig from "@everr/app/drizzle/config";

export default defineConfig({
  ...appConfig,
  out: "./src/drizzle",
  schema: "./src/db/schema/index.ts",
  migrations: {
    table: "__everr_cloud_migrations",
    schema: "drizzle",
  },
});
