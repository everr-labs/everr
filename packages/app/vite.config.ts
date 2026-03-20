import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig(() => ({
  server: {
    allowedHosts: ["host.docker.internal"],
    host: "0.0.0.0",
    port: 5173,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
      router: {
        routeFileIgnorePattern: "\\.test\\.",
      },
    }),
    nitro(),
    viteReact(),
  ],
}));

export default config;
