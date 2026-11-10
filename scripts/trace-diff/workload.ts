// Drives the self-hosted app through a fixed user journey so its server
// traces can be compared between commits with `everr ci trace-diff`.
// The journey must stay the same across runs: a step added here shows up as
// a change in every diff until the baselines on main catch up.
import { createRequire } from "node:module";
import path from "node:path";

const BASE_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const ITERATIONS = Number(process.env.ITERATIONS ?? "3");
// Playwright is not a workspace dependency, so it is installed next to the
// job (see .github/workflows/trace-diff.yml).
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR;
const CHROME = process.env.CHROME_PATH;

const PAGES = [
  "/",
  "/logs",
  "/traces",
  "/errors",
  "/dashboards",
  "/runbooks",
  "/alerts",
  "/api-keys",
];
const OWNER = {
  workspace: "Trace Diff",
  name: "Trace Diff Bot",
  email: "trace-diff@example.com",
  password: "trace-diff-password-123",
};

if (!PLAYWRIGHT_DIR)
  throw new Error("set PLAYWRIGHT_DIR to a directory with playwright-core installed");
// The slice of the Playwright API this script uses. Typed here because the
// package is not installed in the workspace.
type RequestEvent = "request" | "requestfinished" | "requestfailed";
type Page = {
  on(event: RequestEvent, listener: () => void): void;
  off(event: RequestEvent, listener: () => void): void;
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(match: (url: URL) => boolean, options: { timeout: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  context(): { clearCookies(): Promise<void> };
};
type Browser = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
};
type Playwright = {
  chromium: { launch(options: { headless: boolean; executablePath?: string }): Promise<Browser> };
};

const require = createRequire(path.join(PLAYWRIGHT_DIR, "noop.js"));
const { chromium }: Playwright = require("playwright-core");

// Wait until no request has been in flight for `quietMs`. Pages fetch their
// data after hydration, so `load` alone ends the visit before the server
// functions whose traces the diff compares.
async function settle(page: Page, quietMs = 750, timeoutMs = 20_000) {
  let inFlight = 0;
  let lastChange = Date.now();
  const onStart = () => {
    inFlight += 1;
    lastChange = Date.now();
  };
  const onEnd = () => {
    inFlight = Math.max(0, inFlight - 1);
    lastChange = Date.now();
  };
  page.on("request", onStart);
  page.on("requestfinished", onEnd);
  page.on("requestfailed", onEnd);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (inFlight === 0 && Date.now() - lastChange >= quietMs) return;
      await page.waitForTimeout(100);
    }
  } finally {
    page.off("request", onStart);
    page.off("requestfinished", onEnd);
    page.off("requestfailed", onEnd);
  }
}

async function visit(page: Page, route: string) {
  const settled = settle(page);
  await page.goto(new URL(route, BASE_URL).toString(), { waitUntil: "load" });
  await settled;
}

async function setup(page: Page) {
  await page.goto(new URL("/setup", BASE_URL).toString(), { waitUntil: "load" });
  await page.fill("#workspace-name", OWNER.workspace);
  await page.fill("#owner-name", OWNER.name);
  await page.fill("#owner-email", OWNER.email);
  await page.fill("#owner-password", OWNER.password);
  await page.press("#owner-password", "Enter");
  await page.waitForURL((url) => url.pathname !== "/setup", { timeout: 60_000 });
  await settle(page);
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto(new URL("/auth/sign-in", BASE_URL).toString(), { waitUntil: "load" });
  await page.fill("#email", OWNER.email);
  await page.fill("#password", OWNER.password);
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 60_000 });
  await settle(page);
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await setup(page);
  for (let i = 0; i < ITERATIONS; i++) {
    for (const route of PAGES) await visit(page, route);
  }
  await signIn(page);
  console.log(`workload done: setup, ${ITERATIONS}x ${PAGES.length} pages, sign-in`);
} finally {
  await browser.close();
}
