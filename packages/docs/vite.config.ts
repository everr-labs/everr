import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin, lazyPlugins } from "vite-plus";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  ssr: {
    external: ["@takumi-rs/image-response", "@takumi-rs/core"],
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.mjs",
    },
  },
  server: {
    port: 3000,
  },
  plugins: lazyPlugins(async () => [
    devtools(),
    docsMarkdownDevRequests(),
    mdx(await import("./source.config")),
    tailwindcss(),
    tanstackStart(),
    react(),
    nitro({
      preset: "node-server",
      scanDirs: ["."],
      traceDeps: ["@takumi-rs/image-response", "@takumi-rs/core"],
    }),
    svgr(),
  ]),
});

function docsMarkdownDevRequests(): Plugin {
  return {
    name: "everr-docs-markdown-dev-requests",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();

        const pathname = new URL(req.url, "http://localhost").pathname;
        if (
          pathname === "/docs.md" ||
          (pathname.startsWith("/docs/") && pathname.endsWith(".md"))
        ) {
          req.url = `/__docs-markdown?pathname=${encodeURIComponent(pathname)}`;
          req.headers.accept = `text/html,${req.headers.accept ?? "*/*"}`;
        }

        next();
      });
    },
  };
}
