import { defineConfig } from "vite-plus";

export default defineConfig({
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
    reporters: ["verbose"],
  },
});
