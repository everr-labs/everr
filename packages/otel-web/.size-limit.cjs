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
    // Raised for the Session-change listener.
    limit: "4.4 KB",
  },
  {
    name: "core + public tracer",
    path: "dist/index.js",
    import: "{ WebSDK, tracer }",
    gzip: true,
    // Raised for the Session-change listener.
    limit: "4.5 KB",
  },
  {
    // Raised for the parent span support in the tracer.
    // Raised again for span status, links, timestamps, and log correlation.
    // Raised for the Session-change listener.
    name: "core + errors",
    path: "dist/index.js",
    import: "{ WebSDK, errors }",
    gzip: true,
    limit: "5.1 KB",
  },
  {
    // Raised for the exit-flush budget code (refer to pipeline/emitter.ts)
    // and for the parent span support in the tracer.
    // Raised again for span status, links, timestamps, and log correlation.
    // Raised for the Session-change listener.
    name: "core + pageviews",
    path: "dist/index.js",
    import: "{ WebSDK, pageviews }",
    gzip: true,
    limit: "4.55 KB",
  },
  {
    // Raised for the naming attributes in the element selector.
    // Raised again for span status, links, timestamps, and log correlation.
    // Raised for the Session-change listener.
    name: "core + interactions",
    path: "dist/index.js",
    import: "{ WebSDK, interactions }",
    gzip: true,
    limit: "4.95 KB",
  },
  {
    // The heaviest instrumentation: the in-house web vitals (LCP/CLS/TTFB/INP)
    // and slow-interaction records with their LoAF attribution.
    name: "core + performance",
    path: "dist/index.js",
    import: "{ WebSDK, performance }",
    gzip: true,
    // Raised for the Session-change listener.
    limit: "8.35 KB",
  },
  {
    name: "core + network",
    path: "dist/index.js",
    import: "{ WebSDK, network }",
    gzip: true,
    // Includes XHR lifecycle tracking alongside fetch.
    // Raised for the Session-change listener.
    limit: "5.6 KB",
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
    // Raised for the Session-change listener.
    limit: "10.6 KB",
  },
  {
    // The recording entry without the recorder chunk. webpack is off so the
    // dynamic import of the chunk, and the external @everr/otel-web import,
    // stay out of this number. The hash helper is the shared sampled chunk.
    name: "recording stub",
    path: "dist/recording.js",
    import: "{ recording, recorder }",
    gzip: true,
    // The stub imports the live SDK and loads the recorder with import().
    // Neither belongs in this number.
    ignore: ["@everr/otel-web", "./recording/recorder.js"],
    limit: "1.05 KB",
  },
  {
    // @rrweb/record bundled into the chunk the stub loads with import().
    // size-limit minifies the chunk. The raw file is about 32 KB gzipped.
    name: "recording recorder chunk",
    path: "dist/recording/recorder.js",
    gzip: true,
    limit: "26 KB",
  },
];
