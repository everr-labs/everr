import SmeeClient from "smee-client";
import type { Plugin, ViteDevServer } from "vite";

type Logger = Pick<ViteDevServer["config"]["logger"], "error" | "info">;

type SmeeClientOptions = {
  logger: Logger;
  source: string;
  target: string;
};

type SmeeClientLike = {
  start: () => Promise<unknown>;
  stop: () => Promise<void>;
};

type SmeeWebhookPluginOptions = {
  channel?: string;
  createClient?: (options: SmeeClientOptions) => SmeeClientLike;
};

function addressPort(server: ViteDevServer): number | null {
  const address = server.httpServer?.address();

  if (!address || typeof address === "string") return null;

  return address.port;
}

function createSmeeClient(options: SmeeClientOptions): SmeeClientLike {
  return new SmeeClient(options);
}

export function smeeWebhookPlugin({
  channel,
  createClient = createSmeeClient,
}: SmeeWebhookPluginOptions): Plugin {
  let client: SmeeClientLike | null = null;

  return {
    name: "everr:smee-webhook",
    apply: "serve",
    configureServer(server) {
      const normalizedChannel = channel?.trim();
      if (!normalizedChannel) return;

      const start = () => {
        if (client) return;

        const port = addressPort(server) ?? server.config.server.port ?? 5173;
        client = createClient({
          logger: server.config.logger,
          source: `https://smee.io/${normalizedChannel}`,
          target: `http://localhost:${port}/webhook/github`,
        });

        void client.start().catch((error) => {
          server.config.logger.error(
            `[smee] ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      };

      if (server.httpServer?.listening) {
        start();
      } else {
        server.httpServer?.once("listening", start);
      }

      server.httpServer?.once("close", () => {
        const stoppingClient = client;
        client = null;

        void stoppingClient?.stop().catch((error) => {
          server.config.logger.error(
            `[smee] ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });
    },
  };
}
