import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
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
  plugins: [
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
  ],
});

/**
 * In dev the Nitro middleware does not see page requests, so Markdown twins
 * are routed to a dev-only handler instead. Production uses
 * `middleware/agent-requests.ts` for the same paths.
 */
function docsMarkdownDevRequests(): Plugin {
  return {
    name: "everr-docs-markdown-dev-requests",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();

        const pathname = new URL(req.url, "http://localhost").pathname;
        if (pathname.endsWith(".md")) {
          req.url = `/__docs-markdown?pathname=${encodeURIComponent(pathname)}`;
          req.headers.accept = `text/html,${req.headers.accept ?? "*/*"}`;
        }

        next();
      });
    },
  };
}
