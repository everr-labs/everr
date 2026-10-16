import { defineConfig } from "drizzle-kit";
import appConfig from "./drizzle.config";

export default defineConfig({
  ...appConfig,
  out: "./src/cloud/drizzle",
  schema: "./src/cloud/db/schema/index.ts",
  migrations: {
    table: "__everr_cloud_migrations",
    schema: "drizzle",
  },
});
