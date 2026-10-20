#!/usr/bin/env node
// verify-everr web-record: record a scripted browser journey as an H.264 mp4 plus key frames.
// Normally run as `verify-everr web-record --steps <file>`, which fills --base-url, --storage-state and
// --out from the current web run. Standalone: `node record.ts ...` (Node >= 23 strips the types).
//
// Usage:
//   record.ts --base-url <url> --steps <steps.ts> --out <evidence dir>
//             [--name <file stem>] [--cookie <name=value>]... [--storage-state <playwright state.json>]
//             [--viewport 1280x800] [--no-captions] [--crf 28] [--max-mb 10]
//
// The steps file default-exports `async (r: Recorder) => { ... }` (see README.md). Outputs in <out>:
//   <name>.mp4 (H.264, yuv420p, faststart, no audio), <name>-<frame>.png for each r.frame(),
//   <name>.timeline.txt (caption/frame/step timestamps in video time), <name>.probe.txt (ffprobe).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleepMs } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function die(message: string): never {
  console.error(`verify-everr web-record: ${message}`);
  process.exit(1);
}

type Args = {
  baseUrl: string;
  steps: string;
  out: string;
  name: string;
  cookies: string[];
  storageState?: string;
  width: number;
  height: number;
  captions: boolean;
  crf: number;
  maxMb: number;
};

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> & { cookies: string[] } = { cookies: [], captions: true, crf: 28, maxMb: 10, width: 1280, height: 800 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i] ?? die(`${k} needs a value`);
    if (k === "--base-url") a.baseUrl = v().replace(/\/$/, "");
    else if (k === "--steps") a.steps = path.resolve(v());
    else if (k === "--out") a.out = path.resolve(v());
    else if (k === "--name") a.name = v();
    else if (k === "--cookie") a.cookies.push(v());
    else if (k === "--storage-state") a.storageState = path.resolve(v());
    else if (k === "--viewport") {
      const m = /^(\d+)x(\d+)$/.exec(v()) ?? die("--viewport is WxH, e.g. 1280x800");
      a.width = Number(m[1]);
      a.height = Number(m[2]);
    } else if (k === "--no-captions") a.captions = false;
    else if (k === "--crf") a.crf = Number(v());
    else if (k === "--max-mb") a.maxMb = Number(v());
    else if (k === "-h" || k === "--help") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 14).join("\n"));
      process.exit(0);
    } else die(`unknown argument '${k}' (see --help)`);
  }
  if (!a.baseUrl || !a.steps || !a.out) die("--base-url, --steps and --out are required (see --help)");
  if (!existsSync(a.steps)) die(`steps file not found: ${a.steps}`);
  if (a.storageState && !existsSync(a.storageState)) die(`storage state not found: ${a.storageState}`);
  if (!a.name) a.name = path.basename(a.steps).replace(/\.[^.]+$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.name)) die(`invalid --name '${a.name}'`);
  return a as Args;
}

function which(cmd: string): string | undefined {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

// Playwright is not a repo dependency: resolve it from VERIFY_PLAYWRIGHT_DIR, the skill's private install
// dir (~/.cache/verify-everr/playwright), this script's dir, or the cwd.
export const PLAYWRIGHT_HOME = path.join(process.env.HOME ?? "", ".cache/verify-everr/playwright");
async function loadPlaywright(): Promise<any> {
  const bases = [process.env.VERIFY_PLAYWRIGHT_DIR, PLAYWRIGHT_HOME, SCRIPT_DIR, process.cwd()].filter(Boolean) as string[];
  for (const base of bases) {
    const req = createRequire(path.join(base, "noop.js"));
    for (const mod of ["playwright", "playwright-core"]) {
      try {
        return await import(pathToFileURL(req.resolve(mod)).href);
      } catch {}
    }
  }
  die(`playwright not found: \`npm i --prefix ${PLAYWRIGHT_HOME} playwright-core && ${PLAYWRIGHT_HOME}/node_modules/.bin/playwright-core install ffmpeg\`, or set VERIFY_PLAYWRIGHT_DIR`);
}

// Chrome: VERIFY_CHROME, then agent-browser's downloaded Chrome, then a system Chrome/Chromium.
function findChrome(): string {
  if (process.env.VERIFY_CHROME) return process.env.VERIFY_CHROME;
  const abDir = path.join(process.env.HOME ?? "", ".agent-browser/browsers");
  if (existsSync(abDir)) {
    for (const d of readdirSync(abDir).sort().reverse()) {
      const c = path.join(abDir, d, "chrome");
      if (existsSync(c)) return c;
    }
  }
  for (const c of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const p = which(c);
    if (p) return p;
  }
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) if (existsSync(c)) return c;
  die("no Chrome found: set VERIFY_CHROME or run `agent-browser install`");
}

export type Recorder = {
  page: any; // Playwright Page (the only recorded page)
  context: any; // Playwright BrowserContext
  base: string; // --base-url
  out: string; // evidence dir
  /** Show (or clear with "") a caption bar at the bottom of the page; it survives navigations. */
  caption(text: string, opts?: { sub?: string; tone?: "info" | "bad" | "good" }): Promise<void>;
  /** Mark the current video time; a PNG of that video frame is extracted after encoding. */
  frame(name: string): void;
  /** Hold the current screen for ms (keeps the timeline readable). */
  hold(ms: number): Promise<void>;
  /** Log a named segment start into the timeline. */
  step(label: string): void;
  /** Video time (s) now. */
  now(): number;
};

const OVERLAY_JS = `(() => {
  const s = window.__vrCaption; if (!s) { document.getElementById("__vr_caption_host")?.remove(); return; }
  // Lives in a closed shadow root so Playwright locators (getByText etc.) never match caption text.
  let host = document.getElementById("__vr_caption_host");
  if (!host) { host = document.createElement("div"); host.id = "__vr_caption_host"; host.setAttribute("aria-hidden", "true"); (document.body || document.documentElement).appendChild(host); window.__vrRoot = host.attachShadow({ mode: "closed" }); }
  const root = window.__vrRoot; let el = root.firstElementChild;
  if (!el) { el = document.createElement("div"); root.appendChild(el); }
  const bg = s.tone === "bad" ? "rgba(160,20,20,.92)" : s.tone === "good" ? "rgba(20,110,40,.92)" : "rgba(15,15,25,.88)";
  el.setAttribute("style", "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;max-width:88%;padding:10px 18px;border-radius:10px;font:600 18px/1.35 system-ui,sans-serif;color:#fff;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.35);background:" + bg);
  el.innerHTML = "";
  const t = document.createElement("div"); t.textContent = s.text; el.appendChild(t);
  if (s.sub) { const d = document.createElement("div"); d.textContent = s.sub; d.style.cssText = "font-weight:400;font-size:14px;opacity:.85;margin-top:2px"; el.appendChild(d); }
})()`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ffmpeg = which("ffmpeg") ?? die("ffmpeg not found (apt-get install ffmpeg / brew install ffmpeg)");
  const ffprobe = which("ffprobe") ?? die("ffprobe not found (ships with ffmpeg)");
  const pw = await loadPlaywright();
  const chromium = pw.chromium ?? pw.default?.chromium;
  mkdirSync(args.out, { recursive: true });
  const rawDir = path.join(args.out, `.${args.name}-raw`);
  rmSync(rawDir, { recursive: true, force: true });

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const size = { width: args.width, height: args.height };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: rawDir, size },
    ...(args.storageState ? { storageState: args.storageState } : {}),
  });
  if (args.cookies.length) {
    const url = new URL(args.baseUrl);
    await context.addCookies(
      args.cookies.map((c) => {
        const i = c.indexOf("=");
        if (i < 1) die(`--cookie is name=value, got '${c}'`);
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: url.hostname, path: "/", secure: url.protocol === "https:", httpOnly: true };
      }),
    );
  }
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const timeline: string[] = [];
  const frames: { name: string; t: number }[] = [];
  const log = (kind: string, text: string) => {
    const line = `${now().toFixed(1).padStart(6)}s  ${kind.padEnd(7)} ${text}`;
    timeline.push(line);
    console.log(line);
  };
  let current: { text: string; sub?: string; tone?: string } | null = null;
  const apply = async () => {
    if (!args.captions) return;
    await page.evaluate(`window.__vrCaption = ${JSON.stringify(current)}; ${OVERLAY_JS}`).catch(() => {});
  };
  page.on("load", () => void apply());

  const r: Recorder = {
    page,
    context,
    base: args.baseUrl,
    out: args.out,
    async caption(text, opts = {}) {
      current = text ? { text, ...opts } : null;
      log("caption", text ? text + (opts.sub ? ` | ${opts.sub}` : "") : "(cleared)");
      await apply();
    },
    frame(name) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) die(`invalid frame name '${name}'`);
      frames.push({ name, t: now() });
      log("frame", name);
    },
    hold: (ms) => sleepMs(ms),
    step: (label) => log("step", label),
    now,
  };

  const mod = await import(pathToFileURL(args.steps).href);
  const fn = mod.default ?? die("steps file must default-export async (r) => {...}");
  let failed: unknown;
  try {
    await fn(r);
  } catch (e) {
    failed = e;
    log("error", String(e instanceof Error ? e.message : e).split("\n")[0]);
    await page.screenshot({ path: path.join(args.out, `${args.name}-failure.png`) }).catch(() => {});
  }
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video.path();

  const mp4 = path.join(args.out, `${args.name}.mp4`);
  const enc = spawnSync(
    ffmpeg,
    ["-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-preset", "slow", "-crf", String(args.crf),
     "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", "-an", mp4],
    { encoding: "utf8" },
  );
  if (enc.status !== 0) die(`ffmpeg failed: ${enc.stderr}`);
  for (const f of frames) {
    const png = path.join(args.out, `${args.name}-${f.name}.png`);
    const x = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", f.t.toFixed(2), "-i", mp4, "-frames:v", "1", png], { encoding: "utf8" });
    if (x.status !== 0 || !existsSync(png)) console.error(`warning: frame ${f.name} at ${f.t.toFixed(1)}s not extracted: ${x.stderr}`);
  }
  const probe = spawnSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,profile,pix_fmt,width,height,r_frame_rate", "-of", "default=nw=1", mp4],
    { encoding: "utf8" },
  ).stdout;
  writeFileSync(path.join(args.out, `${args.name}.probe.txt`), probe);
  writeFileSync(path.join(args.out, `${args.name}.timeline.txt`), `${timeline.join("\n")}\n`);
  rmSync(rawDir, { recursive: true, force: true });
  const mb = statSync(mp4).size / 1e6;
  const dur = /duration=([\d.]+)/.exec(probe)?.[1];
  const codec = /codec_name=(\w+)/.exec(probe)?.[1];
  console.log(`RECORDED ${mp4} codec=${codec} duration=${Number(dur).toFixed(1)}s size=${mb.toFixed(2)}MB frames=${frames.length}`);
  if (mb > args.maxMb) console.error(`warning: ${mb.toFixed(2)}MB exceeds --max-mb ${args.maxMb}; re-run with a higher --crf`);
  if (failed) die(`steps failed (video of the run so far kept): ${failed instanceof Error ? failed.stack : failed}`);
}

// Only run when executed, not when a steps file imports the Recorder type.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
