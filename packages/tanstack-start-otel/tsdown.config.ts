import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  platform: "node",
  external: [/^@opentelemetry\//, /^@tanstack\//, /^@everr\//, /^node:/],
});
