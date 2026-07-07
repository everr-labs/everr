import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    reporters: ["verbose"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
