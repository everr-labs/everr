// The recorder never sets `recordCanvas`, `inlineImages`, or `collectFonts`, so
// that code of rrweb is dead. But @rrweb/record ships as one prebuilt file
// that reads the three options at run time, and no bundler can remove their
// code. These edits make the three branches constant. Then the bundler drops
// the canvas manager, the 2D and WebGL observers, the argument serializer, the
// inlined worker source, the image inliner, and the font observer.
//
// Each edit must match exactly once. A new rrweb version that moves this code
// fails the build and the tests here, and not the recording in a browser.
const EDITS: [from: string, to: string][] = [
  [
    "canvasManager = new CanvasManager({",
    "canvasManager = { reset() {}, freeze() {}, unfreeze() {}, lock() {}, unlock() {} }; ({",
  ],
  // The worker source is a string that the module turns into a Blob on load.
  [
    'const blob = typeof self !== "undefined" && self.Blob && new Blob([jsContent], { type: "text/javascript;charset=utf-8" });',
    "const blob = false;",
  ],
  // The lookup table of the base64 encoder, which only the canvas recorder calls.
  ["for (var i = 0; i < chars.length; i++) {\n  lookup[chars.charCodeAt(i)] = i;\n}", ""],
  // The data URL of a canvas and of an image in the snapshot.
  ['if (tagName === "canvas" && recordCanvas) {', "if (false) {"],
  ['if (tagName === "img" && inlineImages) {', "if (false) {"],
  ["if (o.collectFonts) {", "if (false) {"],
];

export function stripRrweb() {
  return {
    name: "everr:strip-rrweb",
    transform(code: string, id: string) {
      if (!/@rrweb[\\/]record[\\/]dist[\\/]record\.js/.test(id)) return;
      for (const [from, to] of EDITS) {
        if (code.split(from).length !== 2) {
          throw new Error(`strip-rrweb: expected one match in @rrweb/record for: ${from}`);
        }
        code = code.replace(from, () => to);
      }
      return { code, map: null };
    },
  };
}
