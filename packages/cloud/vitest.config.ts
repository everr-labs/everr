import { resolve } from "node:path";
import { configDefaults } from "vite-plus";
import { alertingIntegrationTests, createAppTestConfig } from "@everr/app/testing/config";
import { cloudComposition } from "./composition";
import { cloudTestMigrations } from "./src/testing/migrations";

const config = createAppTestConfig(cloudComposition, resolve(import.meta.dirname, "./"));
config.test = {
  ...config.test,
  include: [...configDefaults.include, ...alertingIntegrationTests],
  provide: {
    alertingMigrations: cloudTestMigrations,
  },
  exclude: configDefaults.exclude,
};
export default config;
