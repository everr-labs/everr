import { defineConfig } from "tsdown";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "browser",
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageVersion),
  },
});
