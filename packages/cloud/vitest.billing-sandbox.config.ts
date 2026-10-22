import { appAliases } from "@everr/app/build/composition";
import { cloudComposition } from "./composition";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vite-plus";
const env = parse(readFileSync(new URL(".env", import.meta.url), "utf8"));
if (env.POLAR_SERVER !== "sandbox")
  throw new Error("Billing contract tests require Polar sandbox.");
export default defineConfig({
  resolve: { tsconfigPaths: true, alias: appAliases(cloudComposition) },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    environment: "node",
    include: ["src/billing/polar.sandbox.test.ts"],
    env: { ...env, NODE_ENV: "test", EVERR_POLAR_SANDBOX_TEST: "1" },
    testTimeout: 60000,
  },
});
