import { stubTransportFetch } from "./test-fetch.js";

stubTransportFetch(() => {
  throw new Error("Unexpected fetch: configure the test transport first");
});

// jsdom exposes no compression stream, and the Node global that Vitest leaks
// into the environment is not the one a browser page has. The tests take the
// plain JSON path of an old browser by default; the gzip test opts into
// CompressionStream itself, and these saved implementations drive it and read
// the body back.
const runtime = globalThis as typeof globalThis & {
  __testCompressionStream?: typeof CompressionStream;
  __testDecompressionStream?: typeof DecompressionStream;
};
runtime.__testCompressionStream = runtime.CompressionStream;
runtime.__testDecompressionStream = runtime.DecompressionStream;
Object.defineProperty(globalThis, "CompressionStream", {
  value: undefined,
  writable: true,
  configurable: true,
});

// jsdom declares no CSS namespace, so the tests get the escape function of the
// CSSOM specification. It is the same algorithm as the browsers use:
// https://drafts.csswg.org/cssom/#the-css.escape()-method
// The control characters and the lone NULL become hexadecimal escapes, which a
// selector can carry where the raw character cannot.
function cssEscape(value: string): string {
  const str = String(value);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      out += "�";
    } else if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && str.charCodeAt(0) === 0x2d)
    ) {
      out += `\\${code.toString(16)} `;
    } else if (i === 0 && code === 0x2d && str.length === 1) {
      out += `\\${str[i]}`;
    } else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += str[i];
    } else {
      out += `\\${str[i]}`;
    }
  }
  return out;
}

if (typeof globalThis.CSS === "undefined") {
  Object.defineProperty(globalThis, "CSS", {
    value: { escape: cssEscape },
    writable: true,
  });
} else if (typeof globalThis.CSS.escape !== "function") {
  globalThis.CSS.escape = cssEscape;
}
