import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

type Phase = "workers" | "telemetry";
type ShutdownState = {
  hooks: Map<string, { phase: Phase; run: () => Promise<void> }>;
  stopping?: Promise<void>;
};
const globals = globalThis as typeof globalThis & {
  __everrShutdown?: ShutdownState;
};
globals.__everrShutdown ??= { hooks: new Map() };
const state: ShutdownState = globals.__everrShutdown;

export function registerShutdownHook(
  name: string,
  phase: Phase,
  run: () => Promise<void>,
) {
  state.hooks.set(name, { phase, run });
}

// Exposed for tests that verify worker draining before telemetry flushing.
// fallow-ignore-next-line unused-export
export function shutdownRuntime(): Promise<void> {
  state.stopping ??= (async () => {
    const errors: unknown[] = [];
    for (const phase of ["workers", "telemetry"] as const) {
      const results = await Promise.allSettled(
        [...state.hooks.entries()]
          .filter(([, hook]) => hook.phase === phase)
          .map(async ([name, hook]) => {
            try {
              await hook.run();
            } catch (error) {
              serverLogger.error("runtime.shutdown.failed", {
                ...exceptionAttributes(error),
                "everr.shutdown.hook": name,
              });
              throw error;
            }
          }),
      );
      for (const result of results)
        if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length)
      throw new AggregateError(errors, "Runtime shutdown failed");
  })();
  return state.stopping;
}

if (
  !process
    .listeners("SIGTERM")
    .some((listener) => listener.name === "everrShutdown")
) {
  const everrShutdown = () => {
    void shutdownRuntime().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", everrShutdown);
  process.once("SIGINT", everrShutdown);
}
