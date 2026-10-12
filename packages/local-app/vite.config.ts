import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "\\.test\\.",
    }),
    react(),
  ],
  resolve: { tsconfigPaths: true },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:54321", changeOrigin: true } },
  },
});
