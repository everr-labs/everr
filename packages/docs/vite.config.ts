import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.mjs",
    },
  },
  server: {
    port: 3000,
  },
  plugins: [
    devtools(),
    mdx(await import("./source.config")),
    tailwindcss(),
    tanstackStart(),
    react(),
    nitro({
      preset: "node-server",
    }),
    svgr(),
  ],
});
