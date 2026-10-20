#!/usr/bin/env node
// Headless Chrome over CDP (Node >= 22 global WebSocket, no npm deps).
// usage: ui-shot.mjs <url> <outDir> [waitForText] [timeoutMs]
// Writes screenshot.png, dom.html, text.txt (document.body.innerText), url.txt, result.json.
// Exits 1 if waitForText never appears in innerText before the timeout (artifacts still written).
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [url, outDir, waitFor = "", timeoutArg = "20000"] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("usage: ui-shot.mjs <url> <outDir> [waitForText] [timeoutMs]");
  process.exit(2);
}
const chrome = process.env.CHROME || "google-chrome";
const timeout = Number(timeoutArg);
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(process.env.SCRATCH_DIR || tmpdir(), "chrome-"));
const proc = spawn(chrome, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--window-size=1400,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stderr = "";
const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`chrome did not expose DevTools: ${stderr}`)), 15000);
  proc.stderr.on("data", (d) => {
    stderr += d;
    const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

let found = !waitFor;
let exitCode = 0;
try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = (await evaluate("document.body ? document.body.innerText : ''")) || "";
    if (waitFor ? text.includes(waitFor) : (await evaluate("document.readyState")) === "complete") {
      found = true; break;
    }
    await sleep(250);
  }
  await sleep(500); // let the final paint settle
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(outDir, "screenshot.png"), Buffer.from(shot.result.data, "base64"));
  writeFileSync(path.join(outDir, "dom.html"), (await evaluate("document.documentElement.outerHTML")) || "");
  writeFileSync(path.join(outDir, "text.txt"), (await evaluate("document.body.innerText")) || "");
  writeFileSync(path.join(outDir, "url.txt"), `${url}\n`);
  writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ url, waitFor, found, at: new Date().toISOString() }, null, 2));
  if (!found) { console.error(`waitFor text not found within ${timeout}ms: ${waitFor}`); exitCode = 1; }
} finally {
  ws.close();
  proc.kill("SIGTERM");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);
