import { captureError } from "@everr/otel-web";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { toast } from "sonner";

// A short marker so triggered errors are easy to find in Everr.
function marker() {
  return `local-ui-test ${new Date().toISOString()}`;
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
    "everr.error.source": "local-ui.developer",
  });
}

const triggers = [
  { label: "Uncaught error", button: "Throw uncaught error", run: triggerUncaughtError },
  { label: "Unhandled rejection", button: "Reject a promise", run: triggerUnhandledRejection },
  { label: "console.error", button: "Log console.error", run: triggerConsoleError },
  { label: "Handled capture", button: "Capture handled error", run: triggerHandledCapture },
];

export function ErrorTrackingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Error tracking</CardTitle>
        <CardDescription>
          Emit a test error through each browser capture path to verify it reaches Everr.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {triggers.map(({ label, button, run }) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            onClick={() => {
              run();
              toast.success(`${label} triggered. Check Everr.`);
            }}
          >
            {button}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
