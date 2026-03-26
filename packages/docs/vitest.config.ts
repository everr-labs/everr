import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [viteReact()],
	test: {
		environment: "jsdom",
		reporters: ["verbose"],
	},
});
