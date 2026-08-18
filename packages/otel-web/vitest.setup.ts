// jsdom has no CSS.escape (https://github.com/jsdom/jsdom/issues/1550), while
// every browser the SDK targets ships it. This minimal stand-in covers the
// characters the tests exercise; it is not a spec-complete implementation.
globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (v: string) =>
  String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
