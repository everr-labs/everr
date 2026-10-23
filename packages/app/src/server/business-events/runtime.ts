import { runtime } from "@composition/runtime";
import { registerShutdownHook } from "#app/server/shutdown.ts";
import { createBusinessEventPublisher } from "./publisher";
import { publicationDiagnostics } from "./telemetry";

/** Process-local publication; definitions and subscribers are selected by the app. */
export const events = createBusinessEventPublisher({
  ...runtime.businessEvents,
  diagnostics: publicationDiagnostics,
});
registerShutdownHook("business-events", "publications", events.stop);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void events.stop();
  });
}
