import { appAliases } from "./vite.app";
import {parse} from "dotenv";
import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import svgr from "vite-plugin-svgr";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = parse(readFileSync(join(__dirname, ".env.example"), "utf8"))

export default defineConfig(({ mode }) => ({
	resolve: {
		tsconfigPaths: true,
    alias: appAliases(mode === "self-hosted" ? mode : "cloud"),
	},
	plugins: [
		viteReact(),
		svgr({ svgrOptions: { dimensions: false } }),
	],
	test: {
    include: mode === "self-hosted" ? [
      "src/self-hosted/**/*.test.{ts,tsx}",
      "src/server/alerting/history/clickhouse.test.ts",
      "src/telemetry/config.test.ts",
      "src/lib/session-recovery.test.ts",
      "src/routes/-authenticated-guard.test.ts",
      "src/routes/_authenticated/_organization/device.test.tsx",
      "src/routes/api/internal/verify-key.test.ts",
    ] : configDefaults.include,
    exclude: [...configDefaults.exclude, ...(mode === "self-hosted" ? [] : ["src/self-hosted/**"])],
		environment: "jsdom",
		setupFiles: ["./src/test-setup.ts"],
		reporters: ["verbose"],
		env: env,
		},
}));
