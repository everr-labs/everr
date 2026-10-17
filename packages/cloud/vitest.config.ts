import { resolve } from "node:path";
import { configDefaults } from "vitest/config";
import { createAppTestConfig } from "@everr/app/testing/config";
import { appDirectory } from "@everr/app/build/composition";
import { cloudComposition } from "./composition";

const config = await createAppTestConfig(
  cloudComposition,
  resolve(import.meta.dirname, "./"),
);
config.test = {
  ...config.test,
  include: [...configDefaults.include, `${appDirectory}src/**/*.test.{ts,tsx}`],
  exclude: [...configDefaults.exclude, `${appDirectory}src/app/tests/**`],
};
export default config;
