import { fileURLToPath } from "url";
import { createApp, RouterSchemaInput } from "vinxi";
import { config, input } from "vinxi/plugins/config";
import viteReact from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

function trpcRouter({ plugins = () => [] } = {}) {
  return {
    name: "server",
    base: "/trpc",
    type: "http",
    handler: fileURLToPath(new URL("./handler.ts", import.meta.url)),
    target: "server",
    plugins: () => [
      input(
        "$vinxi/trpc/router",
        fileURLToPath(new URL("./src/server/index.ts", import.meta.url))
      ),
    ],
  } satisfies RouterSchemaInput;
}

export default createApp({
  routers: [
    {
      name: "public",
      type: "static",
      dir: "./public",
    },
    trpcRouter(),
    {
      name: "client",
      type: "spa",
      plugins: () => [
        TanStackRouterVite({
          routesDirectory: "./src/app/routes",
          generatedRouteTree: "./src/app/routeTree.gen.ts",
          autoCodeSplitting: true,
        }),
        viteReact(),
      ],
      handler: "./public/index.html",
      base: "/",
      target: "browser",
    },
  ],
});
