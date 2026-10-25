import { runtime } from "@composition/runtime";
import type { TraceConsultations } from "#app/organizations/consultations.ts";
import { events } from "#app/server/events/runtime.ts";
import { registerShutdownHook } from "#app/server/shutdown.ts";

/** Server-only completion capability. Self-hosted has no persistence or CRM dependency. */
export const consultations: TraceConsultations = runtime.createTraceConsultations?.(events) ?? {
  observe() {},
  async stop() {},
};
registerShutdownHook("useful-consultations", "observations", consultations.stop);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void consultations.stop();
  });
}
