import { defineConfig } from "vite-plus";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  pack: {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    platform: "neutral",
    deps: {
      neverBundle: [/^@opentelemetry\//, /^@datadog\//, /^pprof-format/, /^node:/],
    },
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageVersion),
    },
  },
});
