import { captureError } from "@everr/auto-otel-errors/browser";
import { Button } from "@everr/ui/components/button";
import { toast } from "sonner";

import { SettingsSection } from "../desktop-shell/ui";

// A short marker so triggered errors are easy to find in Everr.
function marker() {
  return `desktop-test ${new Date().toISOString()}`;
}

function triggerUncaughtError() {
  const message = `Uncaught test error (${marker()})`;
  // Throw outside React's call stack so it reaches the window "error" handler
  // (mechanism: onerror) instead of being swallowed by an error boundary.
  setTimeout(() => {
    throw new Error(message);
  }, 0);
}

function triggerUnhandledRejection() {
  void Promise.reject(new Error(`Unhandled rejection test (${marker()})`));
}

function triggerConsoleError() {
  console.error(`Console error test (${marker()})`);
}

function triggerHandledCapture() {
  captureError(new Error(`Handled capture test (${marker()})`), {
    "error.handled": true,
    "error.source": "desktop.developer",
  });
}

export function ErrorTrackingSection() {
  function trigger(label: string, fn: () => void) {
    fn();
    toast.success(`${label} triggered — check Everr.`);
  }

  return (
    <SettingsSection
      title="Error tracking"
      description="Emit a test error through each browser capture path to verify it reaches Everr."
      compact
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          onClick={() => trigger("Uncaught error", triggerUncaughtError)}
        >
          Throw uncaught error
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          onClick={() =>
            trigger("Unhandled rejection", triggerUnhandledRejection)
          }
        >
          Reject a promise
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          onClick={() => trigger("console.error", triggerConsoleError)}
        >
          Log console.error
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          onClick={() => trigger("Handled capture", triggerHandledCapture)}
        >
          Capture handled error
        </Button>
      </div>
    </SettingsSection>
  );
}
