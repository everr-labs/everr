// Headless Chrome over CDP (Node >= 22 global WebSocket and fetch, no npm deps).
//
// shot(): render one URL, wait for a text, write screenshot.png, dom.html, text.txt
//   (document.body.innerText), url.txt, result.json. Exit code 1 if navigation fails (navError in
//   result.json) or the text never appears before the timeout; the artifacts are still written.
//
// steps(): run a journey file against a base URL. profileDir keeps the Chrome profile (cookies =
//   session) across calls. The file is a JSON array; each step is one of:
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
//   Writes steps.json (expanded), steps.log (one line per step), console.log (page console +
//   exceptions), result.json. Exit code 1 on the first failing step, after a "failure" shot.
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isRecord, sleep } from "./common.ts";

type Chrome = { chrome: string; env: NodeJS.ProcessEnv; scratchDir: string };

type Click =
  | { by: "selector"; selector: string; hasText?: string }
  | { by: "text"; text: string; within: string }
  | { by: "role"; role: string; name: string };

type Step = { timeout: number } & (
  | { kind: "goto"; path: string }
  | { kind: "waitText"; text: string }
  | { kind: "waitUrl"; pattern: RegExp }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "click"; click: Click }
  | { kind: "assertText"; text: string }
  | { kind: "assertNoText"; text: string }
  | { kind: "shot"; name: string }
);

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Parse one journey step. Keys are checked in the order the steps format documents. */
function parseStep(raw: unknown): Step {
  if (!isRecord(raw)) throw new Error(`unknown step ${JSON.stringify(raw)}`);
  const timeout = typeof raw.timeout === "number" ? raw.timeout : 20000;
  const goto = str(raw.goto);
  if (goto) return { kind: "goto", path: goto, timeout };
  const waitText = str(raw.waitText);
  if (waitText) return { kind: "waitText", text: waitText, timeout };
  const waitUrl = str(raw.waitUrl);
  if (waitUrl) return { kind: "waitUrl", pattern: new RegExp(waitUrl), timeout };
  const fill = str(raw.fill);
  if (fill) return { kind: "fill", selector: fill, value: String(raw.value), timeout };
  const click = str(raw.click);
  if (click) return { kind: "click", click: { by: "selector", selector: click, hasText: str(raw.hasText) }, timeout };
  const clickText = str(raw.clickText);
  if (clickText) return { kind: "click", click: { by: "text", text: clickText, within: str(raw.within) ?? "button, a" }, timeout };
  const clickRole = str(raw.clickRole);
  if (clickRole) return { kind: "click", click: { by: "role", role: clickRole, name: typeof raw.name === "string" ? raw.name : "" }, timeout };
  const assertText = str(raw.assertText);
  if (assertText) return { kind: "assertText", text: assertText, timeout };
  const assertNoText = str(raw.assertNoText);
  if (assertNoText) return { kind: "assertNoText", text: assertNoText, timeout };
  const shot = str(raw.shot);
  if (shot) return { kind: "shot", name: shot, timeout };
  throw new Error(`unknown step ${JSON.stringify(raw)}`);
}

type Reply = { result: Record<string, unknown>; error?: string };

/** One CDP page session on a freshly spawned headless Chrome. */
class Session {
  proc: ChildProcess;
  profile: string;
  keepProfile: boolean;
  stderr = "";
  spawnError: Error | null = null;
  wsUrl: string | null = null;
  ws: WebSocket | null = null;
  nextId = 0;
  pending = new Map<number, (reply: Reply) => void>();
  onEvent: (method: string, params: Record<string, unknown>) => void = () => {};

  constructor(o: Chrome & { profileDir?: string }) {
    this.keepProfile = Boolean(o.profileDir);
    if (o.profileDir) mkdirSync(o.profileDir, { recursive: true });
    this.profile = o.profileDir ?? mkdtempSync(path.join(o.scratchDir, "chrome-"));
    this.proc = spawn(
      o.chrome,
      [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
        `--user-data-dir=${this.profile}`, "--remote-debugging-port=0", "--window-size=1400,900", "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: o.env },
    );
    this.proc.on("error", (e) => {
      this.spawnError = e;
    });
  }

  async connect(chrome: string): Promise<void> {
    const proc = this.proc;
    this.wsUrl = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`chrome did not expose DevTools: ${this.stderr}`)), 15000);
      proc.once("error", (e) => {
        clearTimeout(t);
        reject(new Error(`could not start ${chrome}: ${e.message}`));
      });
      proc.once("exit", (code, sig) => {
        clearTimeout(t);
        reject(new Error(`chrome exited (${code ?? sig}) before DevTools: ${this.stderr}`));
      });
      proc.stderr?.on("data", (d) => {
        this.stderr += String(d);
        const m = this.stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
    });
    const targets: unknown = await (await fetch(`http://127.0.0.1:${new URL(this.wsUrl).port}/json/list`)).json();
    const page = Array.isArray(targets) ? targets.find((t) => isRecord(t) && t.type === "page") : undefined;
    const pageWs = isRecord(page) ? page.webSocketDebuggerUrl : undefined;
    if (typeof pageWs !== "string") throw new Error("chrome has no page target to drive");
    const ws = new WebSocket(pageWs);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("could not open the page DevTools socket")), { once: true });
    });
    ws.addEventListener("message", (e) => {
      const msg: unknown = JSON.parse(String(e.data));
      if (!isRecord(msg)) return;
      if (typeof msg.id === "number") {
        const resolve = this.pending.get(msg.id);
        if (!resolve) return;
        this.pending.delete(msg.id);
        const error = isRecord(msg.error) && typeof msg.error.message === "string" ? msg.error.message : undefined;
        resolve({ result: isRecord(msg.result) ? msg.result : {}, error });
      } else if (typeof msg.method === "string" && isRecord(msg.params)) {
        this.onEvent(msg.method, msg.params);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
    const ws = this.ws;
    if (!ws) throw new Error("not connected");
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const result = reply.result.result;
    return isRecord(result) ? result.value : undefined;
  }

  async innerText(): Promise<string> {
    const v = await this.evaluate("document.body ? document.body.innerText : ''");
    return typeof v === "string" ? v : "";
  }

  /** Page.navigate reports failures (DNS, connection refused, ...) in errorText, not as a CDP error. */
  async navigate(url: string): Promise<string | null> {
    const reply = await this.send("Page.navigate", { url });
    if (reply.error) return reply.error;
    return typeof reply.result.errorText === "string" ? reply.result.errorText : null;
  }

  async screenshot(file: string): Promise<void> {
    const reply = await this.send("Page.captureScreenshot", { format: "png" });
    const data = reply.result.data;
    if (typeof data !== "string") throw new Error(`screenshot failed: ${reply.error ?? "no data"}`);
    writeFileSync(file, Buffer.from(data, "base64"));
  }

  async start(chrome: string): Promise<void> {
    await this.connect(chrome);
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  /** Close Chrome through CDP so it flushes cookies (the session) to the profile; a plain SIGTERM
   * can drop cookies written in the last seconds. Then remove a throwaway profile. */
  async close(): Promise<void> {
    this.ws?.close();
    const proc = this.proc;
    const running = !this.spawnError && proc.exitCode === null && proc.signalCode === null;
    const exited = running ? new Promise((r) => proc.once("exit", r)) : Promise.resolve();
    try {
      if (!this.wsUrl) throw new Error("no DevTools endpoint");
      const browser = new WebSocket(this.wsUrl);
      await new Promise((resolve, reject) => {
        browser.addEventListener("open", resolve, { once: true });
        browser.addEventListener("error", reject, { once: true });
      });
      browser.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    } catch {
      proc.kill("SIGTERM");
    }
    if (!(await Promise.race([exited.then(() => true), sleep(10000).then(() => false)]))) proc.kill("SIGKILL");
    if (!this.keepProfile) rmSync(this.profile, { recursive: true, force: true });
  }
}

async function until(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(250);
  }
  return false;
}

/** Run fn against a started session; any error is printed and becomes exit code 1. */
async function withSession(
  o: Chrome & { profileDir?: string },
  fn: (s: Session) => Promise<number>,
): Promise<number> {
  const session = new Session(o);
  let exitCode = 0;
  try {
    await session.start(o.chrome);
    exitCode = await fn(session);
  } catch (e) {
    console.error(`ui-shot: ${e instanceof Error ? e.message : String(e)}`);
    exitCode = 1;
  } finally {
    await session.close();
  }
  return exitCode;
}

export async function shot(
  o: Chrome & { url: string; outDir: string; waitFor: string; timeoutMs: number },
): Promise<number> {
  mkdirSync(o.outDir, { recursive: true });
  return withSession(o, async (s) => {
    const navError = await s.navigate(o.url);
    const found =
      !navError &&
      (await until(
        async () => (o.waitFor ? (await s.innerText()).includes(o.waitFor) : (await s.evaluate("document.readyState")) === "complete"),
        o.timeoutMs,
      ));
    await sleep(500); // let the final paint settle
    await s.screenshot(path.join(o.outDir, "screenshot.png"));
    const dom = await s.evaluate("document.documentElement.outerHTML");
    writeFileSync(path.join(o.outDir, "dom.html"), typeof dom === "string" ? dom : "");
    writeFileSync(path.join(o.outDir, "text.txt"), await s.innerText());
    writeFileSync(path.join(o.outDir, "url.txt"), `${o.url}\n`);
    writeFileSync(
      path.join(o.outDir, "result.json"),
      JSON.stringify({ url: o.url, waitFor: o.waitFor, found, navError, at: new Date().toISOString() }, null, 2),
    );
    if (navError) {
      console.error(`navigation to ${o.url} failed: ${navError}`);
      return 1;
    }
    if (!found) {
      console.error(`waitFor text not found within ${o.timeoutMs}ms: ${o.waitFor}`);
      return 1;
    }
    return 0;
  });
}

// Accessible name: aria-label, aria-labelledby, <label for>, wrapping <label>, then innerText.
const ACC_NAME = `((e) => (e.getAttribute("aria-label") ||
  (e.getAttribute("aria-labelledby") || "").split(" ").map((i) => document.getElementById(i)?.innerText || "").join(" ") ||
  (e.id && document.querySelector(\`label[for="\${e.id}"]\`)?.innerText) ||
  e.closest("label")?.innerText || e.innerText || "").trim())`;

const NATIVE_ROLE: Record<string, string> = {
  button: "button",
  link: "a[href]",
  switch: "button[role=switch], input[type=checkbox][role=switch]",
  checkbox: "input[type=checkbox]",
  tab: "[role=tab]",
};

/** A JS expression for the element a click step targets (or null). */
function clickTarget(c: Click): string {
  const j = JSON.stringify;
  switch (c.by) {
    case "selector":
      return c.hasText
        ? `[...document.querySelectorAll(${j(c.selector)})].find((e) => e.innerText.includes(${j(c.hasText)}))`
        : `document.querySelector(${j(c.selector)})`;
    case "text":
      return `[...document.querySelectorAll(${j(c.within)})].find((e) => e.innerText.trim() === ${j(c.text)})`;
    case "role": {
      const native = NATIVE_ROLE[c.role];
      const sel = `[role=${c.role}]${native ? `, ${native}` : ""}`;
      return `[...document.querySelectorAll(${j(sel)})].find((e) => ${ACC_NAME}(e).startsWith(${j(c.name)}))`;
    }
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

type Point = { x: number; y: number; disabled: boolean };

async function center(s: Session, expr: string): Promise<Point | null> {
  const v = await s.evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({block: "center"});
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled }; })()`);
  if (!isRecord(v) || typeof v.x !== "number" || typeof v.y !== "number") return null;
  return { x: v.x, y: v.y, disabled: v.disabled === true };
}

async function snapshot(s: Session, prefix: string): Promise<void> {
  await sleep(300);
  await s.screenshot(`${prefix}.png`);
  writeFileSync(`${prefix}.txt`, await s.innerText());
  writeFileSync(`${prefix}.url`, `${await s.evaluate("location.href")}\n`);
}

async function runStep(s: Session, step: Step, baseUrl: string, outDir: string): Promise<boolean> {
  switch (step.kind) {
    case "goto": {
      const navError = await s.navigate(new URL(step.path, baseUrl).toString());
      if (navError) {
        console.error(`navigation failed: ${navError}`);
        return false;
      }
      return until(async () => (await s.evaluate("document.readyState")) === "complete", step.timeout);
    }
    case "waitText":
      return until(async () => (await s.innerText()).includes(step.text), step.timeout);
    case "waitUrl":
      return until(async () => {
        const p = await s.evaluate("location.pathname");
        return step.pattern.test(typeof p === "string" ? p : "");
      }, step.timeout);
    case "fill": {
      const sel = JSON.stringify(step.selector);
      if (!(await until(async () => (await s.evaluate(`!!document.querySelector(${sel})`)) === true, step.timeout))) return false;
      await s.evaluate(`(() => { const el = document.querySelector(${sel}); el.focus(); el.select?.(); })()`);
      await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete" });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete" });
      await s.send("Input.insertText", { text: step.value });
      return (await s.evaluate(`document.querySelector(${sel}).value`)) === step.value;
    }
    case "click": {
      const expr = clickTarget(step.click);
      const target: { pos: Point | null } = { pos: null };
      const ok = await until(async () => {
        target.pos = await center(s, expr);
        return target.pos !== null && !target.pos.disabled;
      }, step.timeout);
      if (!ok || !target.pos) return false;
      const { x, y } = target.pos;
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await s.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      }
      return true;
    }
    case "assertText":
      return (await s.innerText()).includes(step.text);
    case "assertNoText":
      return !(await s.innerText()).includes(step.text);
    case "shot":
      await snapshot(s, path.join(outDir, step.name));
      return true;
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

/** ${NAME} expands from env; an unset name is an error. Returns the raw steps and their parsed form. */
function loadSteps(file: string, env: NodeJS.ProcessEnv): { raw: unknown[]; steps: Step[] } {
  const text = readFileSync(file, "utf8").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const value = env[name];
    if (value === undefined) throw new Error(`steps file uses \${${name}} but it is not set`);
    return value;
  });
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error(`${file} is not a JSON array of steps`);
  return { raw, steps: raw.map(parseStep) };
}

export async function steps(
  o: Chrome & { baseUrl: string; outDir: string; stepsFile: string; profileDir: string },
): Promise<number> {
  mkdirSync(o.outDir, { recursive: true });
  const consoleLog = path.join(o.outDir, "console.log");
  return withSession(o, async (s) => {
    s.onEvent = (method, params) => {
      if (method === "Runtime.consoleAPICalled") {
        const args = Array.isArray(params.args) ? params.args : [];
        const text = args.map((a) => (isRecord(a) ? (a.value ?? a.description ?? "") : "")).join(" ");
        appendFileSync(consoleLog, `[${String(params.type)}] ${text}\n`);
      } else if (method === "Runtime.exceptionThrown") {
        const d = isRecord(params.exceptionDetails) ? params.exceptionDetails : {};
        const description = isRecord(d.exception) ? d.exception.description : undefined;
        appendFileSync(consoleLog, `[exception] ${String(description ?? d.text)}\n`);
      }
    };
    const { raw, steps } = loadSteps(o.stepsFile, o.env);
    writeFileSync(path.join(o.outDir, "steps.json"), JSON.stringify(raw, null, 2));
    const log = path.join(o.outDir, "steps.log");
    writeFileSync(log, "");
    const results: { step: unknown; ok: boolean }[] = [];
    let exitCode = 0;
    for (const [i, step] of steps.entries()) {
      const started = Date.now();
      const ok = await runStep(s, step, o.baseUrl, o.outDir);
      const line = `${ok ? "ok  " : "FAIL"} #${i} ${JSON.stringify(raw[i])} (${Date.now() - started}ms)`;
      appendFileSync(log, `${line}\n`);
      console.log(line);
      results.push({ step: raw[i], ok });
      if (!ok) {
        await snapshot(s, path.join(o.outDir, "failure"));
        exitCode = 1;
        break;
      }
    }
    writeFileSync(
      path.join(o.outDir, "result.json"),
      JSON.stringify({ baseUrl: o.baseUrl, ok: exitCode === 0, results, at: new Date().toISOString() }, null, 2),
    );
    return exitCode;
  });
}
