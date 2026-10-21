import { defineConfig } from "vite-plus";

export default defineConfig({
  // Vitest transforms the files with the resolve conditions of Node. Those
  // conditions select the server entry for the self-import of the react
  // entry, also in the jsdom tests. This alias selects the browser entry. The
  // server tests do not use the package name: they import ./server.js with a
  // relative path.
  resolve: {
    alias: {
      "@everr/otel-web": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    reporters: ["verbose"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
