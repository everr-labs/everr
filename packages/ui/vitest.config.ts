import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Components in this package import their siblings through the package
    // name, the same way its consumers do.
    alias: { "@everr/ui": path.resolve(__dirname, "./src") },
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    environment: "jsdom",
    globals: true,
    reporters: ["verbose"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
