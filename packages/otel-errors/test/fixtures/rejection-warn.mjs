import { startSdk } from "./fixture-sdk.mjs";

// The default mode is "warn". The instrumentation captures the rejection and
// the process continues. A status of 0 shows that the instrumentation did not
// call process.exit(1), and that Node did not do its own crash.
const sdk = startSdk();

Promise.reject(new Error("fixture-rejection"));

// The instrumentation does not flush in this mode. The app shuts down the SDK
// as it does at a normal stop, and that sends the record.
setTimeout(() => {
  void sdk.shutdown().finally(() => process.exit(0));
}, 300);
