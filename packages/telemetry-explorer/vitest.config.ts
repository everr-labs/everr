import path from "node:path";
import { configDefaults, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@everr/ui": path.resolve(__dirname, "../ui/src"),
    },
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    isolate: false,
    // Random file and test order, so a test that depends on another fails
    // early. A failure prints its seed: rerun with --sequence.seed=<seed>.
    sequence: { shuffle: true },
    setupFiles: ["../../vitest.file-isolation.ts"],
    // Only component tests (.test.tsx) pay for a jsdom environment.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: [...configDefaults.exclude, "**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
    globals: true,
  },
});
