import {parse} from "dotenv";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = parse(readFileSync(join(__dirname, ".env.example"), "utf8"))

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		viteReact(),
	],
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test-setup.ts"],
		reporters: ["verbose"],
		env: env,
		},
});
