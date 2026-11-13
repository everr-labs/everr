import { resolve } from "node:path";
import { alertingIntegrationTests, createAppTestConfig } from "@everr/app/testing/config";
import { cloudComposition } from "./composition";
import { cloudTestMigrations } from "./src/testing/migrations";

const config = createAppTestConfig(
  cloudComposition,
  resolve(import.meta.dirname, "./"),
  alertingIntegrationTests,
);
config.test = {
  ...config.test,
  provide: {
    alertingMigrations: cloudTestMigrations,
  },
};
export default config;
