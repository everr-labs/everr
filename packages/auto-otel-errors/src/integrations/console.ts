import { safeStringify } from "../normalize.js";
import type { ConsoleLevel, Integration } from "../types.js";

const BREADCRUMB_LEVELS = ["debug", "info", "log", "warn", "error"] as const;

type PatchableLevel = (typeof BREADCRUMB_LEVELS)[number];

export function consoleIntegration(): Integration {
  const originals = new Map<PatchableLevel, (...args: unknown[]) => void>();

  return {
    name: "console",
    setup(client) {
      const captureLevels: readonly ConsoleLevel[] =
        client.options.console === false
          ? []
          : (client.options.console?.levels ?? ["error"]);
      const breadcrumbsEnabled = client.breadcrumbsEnabledFor("console");
      const patchLevels = new Set<PatchableLevel>([
        ...(breadcrumbsEnabled ? BREADCRUMB_LEVELS : []),
        ...captureLevels,
      ]);

      for (const level of patchLevels) {
        if (originals.has(level)) {
          continue;
        }

        const original = console[level];
        originals.set(level, original);
        console[level] = (...args: unknown[]) => {
          original.apply(console, args);

          try {
            const message = formatArgs(args);
            if (breadcrumbsEnabled) {
              client.addBreadcrumb({ category: "console", message, level });
            }
            if ((captureLevels as readonly string[]).includes(level)) {
              const error =
                args.find((arg): arg is Error => arg instanceof Error) ??
                synthesizeConsoleError(message);
              client.capture({ error, mechanism: "console", handled: true, message });
            }
          } catch {
            // Console output must keep working even if instrumentation fails.
          }
        };
      }
    },
    teardown() {
      for (const [level, original] of originals) {
        console[level] = original;
      }
      originals.clear();
    },
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      arg instanceof Error
        ? `${arg.name}: ${arg.message}`
        : typeof arg === "string"
          ? arg
          : safeStringify(arg),
    )
    .join(" ");
}

function synthesizeConsoleError(message: string): Error {
  const error = new Error(message);
  error.name = "ConsoleError";

  if (error.stack) {
    const lines = error.stack.split("\n");
    error.stack = [
      lines[0],
      ...lines.slice(1).filter((line) => !line.includes("auto-otel-errors")),
    ].join("\n");
  }

  return error;
}
