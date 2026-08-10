import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["verbose"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
