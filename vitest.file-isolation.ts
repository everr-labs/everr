import { afterAll, vi } from "vite-plus/test";

// The test files share a worker (isolate: false), so each file undoes what it
// changed in the worker before the next file runs.

type DocumentBaseline = {
  documentKeys: Set<string>;
  htmlAttributes: Map<string, string>;
  bodyAttributes: Map<string, string>;
};

const attributes = (element: Element) =>
  new Map(Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]));

function restoreAttributes(element: Element, baseline: Map<string, string>) {
  for (const name of element.getAttributeNames()) {
    if (!baseline.has(name)) element.removeAttribute(name);
  }
  for (const [name, value] of baseline) element.setAttribute(name, value);
}

// This file runs again before each test file, so the first run in the worker
// records the document as the environment created it.
declare global {
  var __everrTestDocumentBaseline: DocumentBaseline | undefined;
}
if (typeof document !== "undefined") {
  globalThis.__everrTestDocumentBaseline ??= {
    documentKeys: new Set(Object.getOwnPropertyNames(document)),
    htmlAttributes: attributes(document.documentElement),
    bodyAttributes: attributes(document.body),
  };
}

afterAll(() => {
  const baseline = globalThis.__everrTestDocumentBaseline;
  if (typeof document !== "undefined" && baseline) {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    restoreAttributes(document.documentElement, baseline.htmlAttributes);
    restoreAttributes(document.body, baseline.bodyAttributes);
    // Tests override document getters such as visibilityState with own
    // properties, which hide the getters from the next file.
    for (const key of Object.getOwnPropertyNames(document)) {
      if (!baseline.documentKeys.has(key)) Reflect.deleteProperty(document, key);
    }
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // The next file imports fresh copies of the source modules, so its vi.mock
  // calls apply and no module state carries over.
  vi.resetModules();
});
