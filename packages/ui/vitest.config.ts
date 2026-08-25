import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Components in this package import their siblings through the package
    // name, the same way its consumers do.
    alias: { "@everr/ui": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    reporters: ["verbose"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
