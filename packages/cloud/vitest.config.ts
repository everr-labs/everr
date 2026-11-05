import { resolve } from "node:path";
import { termsDocument } from "./build/terms";
import { configDefaults } from "vite-plus";
import { alertingIntegrationTests, createAppTestConfig } from "@everr/app/testing/config";
import { cloudComposition } from "./composition";
import { cloudTestMigrations } from "./src/testing/migrations";

const config = createAppTestConfig(cloudComposition, resolve(import.meta.dirname, "./"));
config.plugins = [
  ...(config.plugins ?? []),
  termsDocument(resolve(import.meta.dirname, "../docs/content/legal/terms.mdx")),
];
config.test = {
  ...config.test,
  include: [...configDefaults.include, ...alertingIntegrationTests],
  provide: {
    alertingMigrations: cloudTestMigrations,
  },
  exclude: configDefaults.exclude,
};
export default config;
