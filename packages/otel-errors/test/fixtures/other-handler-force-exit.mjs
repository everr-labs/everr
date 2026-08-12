import { startSdk } from "./fixture-sdk.mjs";

// The same condition as other-handler-no-exit.mjs, but the app asks the
// instrumentation to stop the process in all conditions. Thus the listener of
// the app cannot prevent the exit.
startSdk({ exitEvenIfOtherHandlersAreRegistered: true });

process.on("uncaughtException", () => {
  // The same as the other fixture: the listener exists, and it does nothing.
});

setTimeout(() => {
  throw new Error("fixture-force-exit");
}, 10);

// A status of 7 shows that the instrumentation did not stop the process. The
// test then fails with a clear value and it does not wait for the time limit.
setTimeout(() => process.exit(7), 1000);
