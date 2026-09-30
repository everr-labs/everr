import { Worker } from "node:worker_threads";

// A worker thread registers the instrumentation, then throws. The parent must
// get the "error" event, as it does with no instrumentation. A process.exit in
// the worker ends the thread without that event.
const worker = new Worker(
  `
  import(${JSON.stringify(new URL("../../dist/node.js", import.meta.url).href)}).then(
    ({ ErrorsInstrumentation }) => {
      new ErrorsInstrumentation({ shutdownTimeout: 50 });
      setTimeout(() => { throw new Error("fixture-worker-crash"); }, 10);
    },
  );
  `,
  { eval: true, stderr: true },
);

// A status of 0 shows that the parent got the "error" event. A status of 3
// shows that the worker ended without it.
let sawError = false;
worker.on("error", () => {
  sawError = true;
});
worker.on("exit", () => {
  process.exit(sawError ? 0 : 3);
});
