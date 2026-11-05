import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Both deployments derive their revision from the exact same source bytes. */
export function termsDocument(path: string): Plugin {
  return {
    name: "everr-terms-document",
    config() {
      const source = readFileSync(path, "utf8");
      return {
        define: {
          "import.meta.env.VITE_TERMS_HASH": JSON.stringify(
            createHash("sha256").update(source).digest("hex"),
          ),
        },
      };
    },
    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on("change", (changed) => {
        if (changed === path) void server.restart();
      });
    },
  };
}
