import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vitest transforms the files with the resolve conditions of Node. Those
  // conditions select the server module for "#report", also in the jsdom
  // tests. This alias selects the browser module. The server tests do not use
  // "#report": server.ts imports report.server.ts with a relative path.
  resolve: {
    alias: {
      "#report": new URL("./src/report.browser.ts", import.meta.url).pathname,
    },
  },
  test: {
    reporters: ["verbose"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
