#!/usr/bin/env node
// Headless Chrome over CDP (Node >= 22 global WebSocket, no npm deps).
//
// Shot mode (local UI):
//   ui-shot.mjs <url> <outDir> [waitForText] [timeoutMs]
//   Writes screenshot.png, dom.html, text.txt (document.body.innerText), url.txt, result.json.
//   Exits 1 if waitForText never appears in innerText before the timeout (artifacts still written).
//
// Steps mode (web app journeys):
//   ui-shot.mjs steps <baseUrl> <outDir> <steps.json>
//   Env PROFILE_DIR keeps the Chrome profile (cookies = session) across invocations.
//   steps.json is an array; each step is one of:
//     {"goto": "/auth/sign-up"}                     navigate (relative to baseUrl)
//     {"waitText": "Create your account"}            wait until innerText contains it
//     {"waitUrl": "^/(dashboards|$)"}                wait until location.pathname matches the regex
//     {"fill": "#email", "value": "a@b.c"}          focus a CSS selector, clear it, type the value
//     {"click": "button[type=submit]"}              real mouse click on a CSS selector
//     {"click": "button", "hasText": "Verify Bot"}  ...on the first match whose innerText contains hasText
//     {"clickText": "Continue", "within": "button"} real click on the first <within> whose trimmed text equals it
//     {"clickRole": "switch", "name": "Send telemetry"} real click on the first [role] (or native
//                                                     equivalent) whose accessible name starts with name
//     {"assertText": "..."} / {"assertNoText": "..."} check innerText now
//     {"shot": "after-signup"}                       save <name>.png, <name>.txt, <name>.url
//   Optional "timeout" (ms, default 20000) on any waiting step. ${NAME} anywhere in the file is
//   replaced with the environment variable NAME (unset = error), e.g. "${VERIFY_EMAIL}".
//   Writes steps.log (one line per step), console.log (page console + exceptions), result.json.
//   Exits 1 on the first failing step, after taking a "failure" shot.
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const stepsMode = argv[0] === "steps";
const usage = "usage: ui-shot.mjs <url> <outDir> [waitForText] [timeoutMs]\n       ui-shot.mjs steps <baseUrl> <outDir> <steps.json>";
if (stepsMode ? argv.length < 4 : argv.length < 2) { console.error(usage); process.exit(2); }

const chrome = process.env.CHROME || "google-chrome";
const outDir = stepsMode ? argv[2] : argv[1];
mkdirSync(outDir, { recursive: true });
const keepProfile = stepsMode && process.env.PROFILE_DIR;
const profile = keepProfile
  ? (mkdirSync(process.env.PROFILE_DIR, { recursive: true }), process.env.PROFILE_DIR)
  : mkdtempSync(path.join(process.env.SCRATCH_DIR || tmpdir(), "chrome-"));
const proc = spawn(chrome, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--window-size=1400,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stderr = "";
let spawnError = null;
proc.on("error", (e) => { spawnError = e; });
let wsUrl = null;
let ws = null;
let id = 0;
const pending = new Map();
const consoleLog = path.join(outDir, "console.log");
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const innerText = async () => (await evaluate("document.body ? document.body.innerText : ''")) || "";
// Page.navigate reports failures (DNS, connection refused, ...) in result.errorText, not as a CDP error.
const navigate = async (url) => {
  const res = await send("Page.navigate", { url });
  return res.error?.message ?? res.result?.errorText ?? null;
};

async function connect() {
  wsUrl = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`chrome did not expose DevTools: ${stderr}`)), 15000);
    proc.once("error", (e) => { clearTimeout(t); reject(new Error(`could not start ${chrome}: ${e.message}`)); });
    proc.once("exit", (code, sig) => { clearTimeout(t); reject(new Error(`chrome exited (${code ?? sig}) before DevTools: ${stderr}`)); });
    proc.stderr.on("data", (d) => {
      stderr += d;
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("chrome has no page target to drive");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", () => j(new Error("could not open the page DevTools socket")), { once: true });
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (!stepsMode) return;
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      appendFileSync(consoleLog, `[${msg.params.type}] ${text}\n`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      appendFileSync(consoleLog, `[exception] ${d.exception?.description ?? d.text}\n`);
    }
  });
}

async function until(check, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(250);
  }
  return false;
}

async function snapshot(prefix) {
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${prefix}.png`, Buffer.from(shot.result.data, "base64"));
  writeFileSync(`${prefix}.txt`, await innerText());
  writeFileSync(`${prefix}.url`, `${await evaluate("location.href")}\n`);
}

async function center(expr) {
  return evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({block: "center"});
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled }; })()`);
}

async function mouseClick({ x, y }) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

async function runStep(step, baseUrl) {
  const timeout = step.timeout ?? 20000;
  if (step.goto) {
    const navError = await navigate(new URL(step.goto, baseUrl).toString());
    if (navError) { console.error(`navigation failed: ${navError}`); return false; }
    return until(async () => (await evaluate("document.readyState")) === "complete", timeout);
  }
  if (step.waitText) return until(async () => (await innerText()).includes(step.waitText), timeout);
  if (step.waitUrl) {
    const re = new RegExp(step.waitUrl);
    return until(async () => re.test(await evaluate("location.pathname")), timeout);
  }
  if (step.fill) {
    const sel = JSON.stringify(step.fill);
    if (!(await until(async () => evaluate(`!!document.querySelector(${sel})`), timeout))) return false;
    await evaluate(`(() => { const el = document.querySelector(${sel}); el.focus(); el.select?.(); })()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete" });
    await send("Input.insertText", { text: String(step.value) });
    return (await evaluate(`document.querySelector(${sel}).value`)) === String(step.value);
  }
  if (step.click || step.clickText || step.clickRole) {
    const native = { button: "button", link: "a[href]", switch: "button[role=switch], input[type=checkbox][role=switch]", checkbox: "input[type=checkbox]", tab: "[role=tab]" };
    const roleSel = step.clickRole ? `[role=${step.clickRole}]${native[step.clickRole] ? `, ${native[step.clickRole]}` : ""}` : "";
    const accName = `((e) => (e.getAttribute("aria-label") ||
      (e.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.innerText || "").join(" ") ||
      (e.id && document.querySelector(\`label[for="\${e.id}"]\`)?.innerText) ||
      e.closest("label")?.innerText || e.innerText || "").trim())`;
    const expr = step.click
      ? (step.hasText
        ? `[...document.querySelectorAll(${JSON.stringify(step.click)})].find((e) => e.innerText.includes(${JSON.stringify(step.hasText)}))`
        : `document.querySelector(${JSON.stringify(step.click)})`)
      : step.clickRole
        ? `[...document.querySelectorAll(${JSON.stringify(roleSel)})].find((e) => ${accName}(e).startsWith(${JSON.stringify(step.name ?? "")}))`
        : `[...document.querySelectorAll(${JSON.stringify(step.within ?? "button, a")})].find((e) => e.innerText.trim() === ${JSON.stringify(step.clickText)})`;
    let pos = null;
    const ok = await until(async () => { pos = await center(expr); return pos && !pos.disabled; }, timeout);
    if (!ok) return false;
    await mouseClick(pos);
    return true;
  }
  if (step.assertText) return (await innerText()).includes(step.assertText);
  if (step.assertNoText) return !(await innerText()).includes(step.assertNoText);
  if (step.shot) { await snapshot(path.join(outDir, step.shot)); return true; }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

let exitCode = 0;
try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  if (stepsMode) {
    const [, baseUrl, , stepsFile] = argv;
    // ${NAME} in the steps file expands from the environment; an unset name is an error.
    const raw = readFileSync(stepsFile, "utf8").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
      if (process.env[name] === undefined) throw new Error(`steps file uses \${${name}} but it is not set`);
      return process.env[name];
    });
    const steps = JSON.parse(raw);
    writeFileSync(path.join(outDir, "steps.json"), JSON.stringify(steps, null, 2));
    const log = path.join(outDir, "steps.log");
    writeFileSync(log, "");
    const results = [];
    for (const [i, step] of steps.entries()) {
      const started = Date.now();
      const ok = await runStep(step, baseUrl);
      const line = `${ok ? "ok  " : "FAIL"} #${i} ${JSON.stringify(step)} (${Date.now() - started}ms)`;
      appendFileSync(log, `${line}\n`);
      console.log(line);
      results.push({ step, ok });
      if (!ok) { await snapshot(path.join(outDir, "failure")); exitCode = 1; break; }
    }
    writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ baseUrl, ok: exitCode === 0, results, at: new Date().toISOString() }, null, 2));
  } else {
    const [url, , waitFor = "", timeoutArg = "20000"] = argv;
    const navError = await navigate(url);
    const found = !navError && await until(async () => (waitFor
      ? (await innerText()).includes(waitFor)
      : (await evaluate("document.readyState")) === "complete"), Number(timeoutArg));
    await sleep(500); // let the final paint settle
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(outDir, "screenshot.png"), Buffer.from(shot.result.data, "base64"));
    writeFileSync(path.join(outDir, "dom.html"), (await evaluate("document.documentElement.outerHTML")) || "");
    writeFileSync(path.join(outDir, "text.txt"), await innerText());
    writeFileSync(path.join(outDir, "url.txt"), `${url}\n`);
    writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ url, waitFor, found, navError, at: new Date().toISOString() }, null, 2));
    if (navError) { console.error(`navigation to ${url} failed: ${navError}`); exitCode = 1; }
    else if (!found) { console.error(`waitFor text not found within ${timeoutArg}ms: ${waitFor}`); exitCode = 1; }
  }
} catch (e) {
  console.error(`ui-shot: ${e.message}`);
  exitCode = 1;
} finally {
  ws?.close();
  // Close Chrome through CDP so it flushes cookies (the session) to the profile;
  // a plain SIGTERM can drop cookies written in the last seconds.
  const running = !spawnError && proc.exitCode === null && proc.signalCode === null;
  const exited = running ? new Promise((r) => proc.once("exit", r)) : Promise.resolve();
  try {
    if (!wsUrl) throw new Error("no DevTools endpoint");
    const browser = new WebSocket(wsUrl);
    await new Promise((r, j) => { browser.addEventListener("open", r, { once: true }); browser.addEventListener("error", j, { once: true }); });
    browser.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  } catch { proc.kill("SIGTERM"); }
  if (!(await Promise.race([exited.then(() => true), sleep(10000).then(() => false)]))) proc.kill("SIGKILL");
  if (!keepProfile) rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);
