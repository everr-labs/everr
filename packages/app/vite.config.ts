import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

const DEFAULT_LOCAL_OTEL_ENDPOINT = "http://127.0.0.1:54318";
const NODE_INSTRUMENTATION_MODULE = new URL(
  "src/instrumentation.node.mjs",
  import.meta.url,
).href;

const config = defineConfig(async ({ command, mode }) => {
  if (command === "serve" && mode === "development") {
    await import(NODE_INSTRUMENTATION_MODULE);
  }

  const env = loadEnv(mode, process.cwd(), "");
  const browserTelemetryEnabled = mode === "development";
  const browserTelemetryEndpoint = browserTelemetryEnabled
    ? env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
      env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      DEFAULT_LOCAL_OTEL_ENDPOINT
    : "";

  return {
    define: {
      __EVERR_BROWSER_OTEL__: JSON.stringify({
        enabled: browserTelemetryEnabled,
        endpoint: browserTelemetryEndpoint,
        serviceName:
          env.VITE_OTEL_SERVICE_NAME ||
          env.OTEL_SERVICE_NAME ||
          "everr-web-browser",
        serviceVersion: env.npm_package_version || "0.1.0",
      }),
    },
    server: {
      allowedHosts: ["host.docker.internal"],
      host: "0.0.0.0",
      port: 5173,
    },
    resolve: {
      tsconfigPaths: true,
      alias: [
        // tslib gets pulled in by Radix UI on SSR. Nitro/Rollup wraps tslib's
        // CJS as `__toESM(tslib).default` and destructures helpers off `.default`,
        // which is undefined — crashing route loaders with "Cannot destructure
        // property '__extends'". Pin to the ESM file directly to bypass the
        // CJS interop path entirely.
        {
          find: /^tslib$/,
          replacement: "tslib/tslib.es6.mjs",
        },
        // use-sync-external-store is a CJS shim that does require("react") which
        // Rollup can't inline for SSR, causing "Cannot find module 'react'" in
        // production. React 19 exports useSyncExternalStore natively, so we
        // redirect to our thin ESM wrappers that import from react directly.
        {
          find: "use-sync-external-store/shim/with-selector",
          replacement: new URL(
            "src/ssr-shims/use-sync-external-store-with-selector.ts",
            import.meta.url,
          ).pathname,
        },
        {
          find: "use-sync-external-store/shim",
          replacement: new URL(
            "src/ssr-shims/use-sync-external-store-shim.ts",
            import.meta.url,
          ).pathname,
        },
      ],
    },
    plugins: [
      devServerTelemetryPlugin(browserTelemetryEnabled),
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
  };
});

export default config;

function devServerTelemetryPlugin(enabled: boolean): Plugin {
  return {
    name: "everr-dev-server-telemetry",
    apply: "serve",
    configureServer(server) {
      if (!enabled) {
        return;
      }

      const tracer = trace.getTracer("everr-vite-dev-server");
      const errorLogger = logs.getLogger("everr-vite-dev-server-errors");

      server.middlewares.use((req, res, next) => {
        const method = req.method || "GET";
        const url = req.url || "/";
        const parsedUrl = new URL(url, "http://localhost");
        const span = tracer.startSpan(`${method} ${parsedUrl.pathname}`, {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": method,
            "url.path": parsedUrl.pathname,
            "url.query": parsedUrl.search.replace(/^\?/, ""),
            "server.address": "localhost",
            "http.route": parsedUrl.pathname,
          },
        });
        let finished = false;

        const finish = () => {
          if (finished) {
            return;
          }

          finished = true;
          const statusCode = res.statusCode;
          span.setAttribute("http.response.status_code", statusCode);

          if (statusCode >= 500) {
            const message = `${method} ${parsedUrl.pathname} returned HTTP ${statusCode}`;
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message,
            });

            context.with(trace.setSpan(context.active(), span), () => {
              errorLogger.emit({
                severityNumber: SeverityNumber.ERROR,
                severityText: "ERROR",
                body: message,
                attributes: {
                  "error.source": "vite.dev.response",
                  "exception.escaped": false,
                  "http.request.method": method,
                  "http.response.status_code": statusCode,
                  "url.path": parsedUrl.pathname,
                  "url.query": parsedUrl.search.replace(/^\?/, ""),
                },
              });
            });
          }

          span.end();
        };

        res.once("finish", finish);
        res.once("close", finish);

        try {
          context.with(trace.setSpan(context.active(), span), next);
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          }

          finish();
          throw error;
        }
      });
    },
  };
}
