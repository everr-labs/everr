// Frames the Node.js profiler adds for time no JavaScript function accounts
// for. Their names come from @datadog/pprof.
const RUNTIME_FRAMES = new Map<string, string>([
  [
    "Non JS threads activity",
    "CPU used by the process's other threads: garbage collection helpers, the libuv thread pool and the compiler. They run alongside JavaScript, so CPU time can exceed wall time.",
  ],
  ["Garbage Collection", "Time V8 spent collecting garbage on the JavaScript thread."],
  [
    "(idle)",
    "CPU from samples taken while the JavaScript thread was idle. Each sample carries the CPU used since the previous one, so this is work that finished between samples: short tasks and event loop overhead. Hidden unless Include idle is on.",
  ],
]);

/** What a runtime frame measures, or undefined for an ordinary function. */
export function runtimeFrameNote(name: string): string | undefined {
  return RUNTIME_FRAMES.get(name);
}
