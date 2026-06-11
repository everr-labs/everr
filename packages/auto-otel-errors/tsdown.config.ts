import { defineConfig } from "tsdown";

export default defineConfig({
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
});
