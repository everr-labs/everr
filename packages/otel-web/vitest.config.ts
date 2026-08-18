import { defineConfig } from "vitest/config";

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
    reporters: ["verbose"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
