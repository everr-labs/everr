// One budget per public composition, each using size-limit's `import` option
// so only the named exports get pulled into the measured bundle: this checks
// that tree shaking actually works, rather than assuming it does from one
// whole-file number. A regression on any single line fails CI on that line,
// not just on an aggregate total.
//
// Limits carry a small headroom (roughly 5%) over the measured size at the
// time they were set; a real regression still trips them.
module.exports = [
  {
    name: "core (WebSDK only, no instrumentations)",
    path: "dist/index.js",
    import: "{ WebSDK }",
    gzip: true,
    // Includes the shared tracer binding and span-kind support.
    // Raised for span status, links, timestamps, and log correlation.
    limit: "4.2 KB",
  },
  {
    name: "core + public tracer",
    path: "dist/index.js",
    import: "{ WebSDK, tracer }",
    gzip: true,
    limit: "4.25 KB",
  },
  {
    // Raised for the parent span support in the tracer.
    // Raised again for span status, links, timestamps, and log correlation.
    name: "core + errors",
    path: "dist/index.js",
    import: "{ WebSDK, errors }",
    gzip: true,
    limit: "4.9 KB",
  },
  {
    // Raised for the exit-flush budget code (refer to pipeline/emitter.ts)
    // and for the parent span support in the tracer.
    // Raised again for span status, links, timestamps, and log correlation.
    name: "core + pageviews",
    path: "dist/index.js",
    import: "{ WebSDK, pageviews }",
    gzip: true,
    limit: "4.35 KB",
  },
  {
    // Raised for the naming attributes in the element selector.
    // Raised again for span status, links, timestamps, and log correlation.
    name: "core + interactions",
    path: "dist/index.js",
    import: "{ WebSDK, interactions }",
    gzip: true,
    limit: "4.75 KB",
  },
  {
    // The heaviest instrumentation: the in-house web vitals (LCP/CLS/TTFB/INP)
    // and slow-interaction records with their LoAF attribution.
    name: "core + performance",
    path: "dist/index.js",
    import: "{ WebSDK, performance }",
    gzip: true,
    limit: "8.1 KB",
  },
  {
    name: "core + network",
    path: "dist/index.js",
    import: "{ WebSDK, network }",
    gzip: true,
    // Includes XHR lifecycle tracking alongside fetch.
    limit: "5.4 KB",
  },
  {
    // All instrumentation factories composed: verifies the sampled runtime is
    // shared rather than duplicated per composition, so this comes in below
    // the sum of the individual increments above, not above it.
    name: "core + all instrumentations",
    path: "dist/index.js",
    import: "{ WebSDK, errors, pageviews, interactions, performance, network, sampled }",
    gzip: true,
    // Includes XHR lifecycle tracking alongside fetch.
    limit: "10 KB",
  },
  {
    // The stub only. The main entry and the recorder chunk load on their own.
    name: "recording stub",
    path: "dist/recording.js",
    import: "{ recording, recorder }",
    gzip: true,
    ignore: ["@everr/otel-web"],
    modifyEsbuildConfig: (config) => ({
      ...config,
      external: [...(config.external ?? []), "./recording/recorder.js"],
    }),
    limit: "1.05 KB",
  },
  {
    // rrweb record is most of it.
    name: "recording chunk",
    path: "dist/recording/recorder.js",
    import: "{ startStream }",
    gzip: true,
    ignore: ["@everr/otel-web"],
    limit: "26 KB",
  },
];
