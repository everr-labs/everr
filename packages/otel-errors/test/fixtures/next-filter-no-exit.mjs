import { startSdk } from "./fixture-sdk.mjs";

// Next.js 16 installs one "unhandledRejection" listener of its own, a filter.
// Then it patches process.on and process.listeners: each later listener goes
// into a private queue that the filter calls, and process.listeners returns
// that queue. It does not patch process.listenerCount, which thus counts only
// the filter. This shim does the same as
// next/dist/server/node-environment-extensions/unhandled-rejection.external.js.
const queue = [];
const originalOn = process.on;
const originalOff = process.off;
const originalListeners = process.listeners;
originalOn.call(process, "unhandledRejection", function filter(...args) {
  for (const listener of [...queue]) listener(...args);
});
process.on = process.addListener = function (event, listener) {
  if (event === "unhandledRejection") {
    queue.push(listener);
    return process;
  }
  return originalOn.call(process, event, listener);
};
process.off = process.removeListener = function (event, listener) {
  if (event === "unhandledRejection") {
    const index = queue.lastIndexOf(listener);
    if (index > -1) queue.splice(index, 1);
    return process;
  }
  return originalOff.call(process, event, listener);
};
process.listeners = function (event) {
  return event === "unhandledRejection"
    ? [originalListeners.call(process, event)[0], ...queue]
    : originalListeners.call(process, event);
};

// Next registers its own listener, which writes the rejection and continues.
process.on("unhandledRejection", (reason) => {
  console.error("next-log", reason);
});

startSdk();

Promise.reject(new Error("fixture-next-rejection"));

// The process must end for the test. A status of 0 shows that the
// instrumentation did not call process.exit(1).
setTimeout(() => process.exit(0), 300);
