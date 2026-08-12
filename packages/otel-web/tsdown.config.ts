import { defineConfig } from "tsdown";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    server: "src/server.ts",
  },
  // The react bundle must keep its import of the package name. If the build
  // resolves it, the react bundle contains the entry of one runtime, and the
  // selection by the "." export conditions of the consumer is lost.
  external: ["@everr/otel-web"],
  format: ["esm"],
  dts: true,
  platform: "browser",
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageVersion),
  },
});
