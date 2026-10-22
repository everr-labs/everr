import { appAliases } from "@everr/app/build/composition";
import { cloudComposition } from "./composition";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";
const env = parse(readFileSync(new URL(".env", import.meta.url), "utf8"));
if (env.POLAR_SERVER !== "sandbox") throw new Error("Billing contract tests require Polar sandbox.");
export default defineConfig({ resolve: { tsconfigPaths: true, alias: appAliases(cloudComposition) }, test: { environment: "node", include: ["src/billing/polar.sandbox.test.ts"], env: { ...env, NODE_ENV: "test", EVERR_POLAR_SANDBOX_TEST: "1" }, testTimeout: 60000 } });
