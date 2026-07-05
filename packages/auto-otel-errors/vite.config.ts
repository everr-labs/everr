import { defineConfig } from "vite-plus";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  pack: {
    entry: {
      node: "src/node.ts",
      browser: "src/browser.ts",
      express: "src/express.ts",
      fastify: "src/fastify.ts",
      react: "src/react.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    platform: "neutral",
    external: [/^@opentelemetry\//, "react", /^node:/],
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageVersion),
    },
  },
});
