import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 600_000,
    include: ["clickhouse/**/*.test.ts"],
    reporters: ["verbose"],
    testTimeout: 120_000,
  },
});
