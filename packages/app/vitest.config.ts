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
    include: mode === "self-hosted" ? ["src/self-hosted/**/*.test.{ts,tsx}"] : configDefaults.include,
    exclude: [...configDefaults.exclude, ...(mode === "self-hosted" ? [] : ["src/self-hosted/**"])],
		environment: "jsdom",
		setupFiles: ["./src/test-setup.ts"],
		reporters: ["verbose"],
		env: env,
		},
}));
