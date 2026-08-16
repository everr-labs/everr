import { startSdk } from "./fixture-sdk.mjs";

// The app installs its own listener, and the instrumentation keeps its default
// configuration. Thus the instrumentation captures the error but it does not
// stop the process, because the app owns the exit decision.
startSdk();

process.on("uncaughtException", () => {
  // The app writes its own report here. This fixture only keeps the listener.
});

setTimeout(() => {
  throw new Error("fixture-other-handler");
}, 10);

// The process must end for the test. A status of 0 shows that the
// instrumentation did not call process.exit(1).
setTimeout(() => process.exit(0), 300);
