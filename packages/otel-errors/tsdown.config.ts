import { defineConfig } from "tsdown";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  entry: {
    node: "src/node.ts",
    core: "src/core.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  external: [/^@opentelemetry\//, /^node:/],
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageVersion),
  },
});
