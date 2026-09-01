import { beforeEach, describe, expect, it, vi } from "vitest";

const KNOWN_PATHS = new Set([
  "/",
  "/pricing",
  "/about",
  "/docs",
  "/docs/learn/install",
]);

vi.mock("./site-pages", () => ({
  isKnownPagePath: (pathname: string) =>
    KNOWN_PATHS.has(
      pathname.length > 1 && pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname,
    ),
  normalizePagePath: (pathname: string) =>
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname,
}));

const renderPageMarkdown = vi.fn(async (path: string, _siteUrl: string) =>
  KNOWN_PATHS.has(path) ? `# ${path}` : null,
);

vi.mock("./markdown-pages", () => ({
  renderPageMarkdown: (path: string, siteUrl: string) =>
    renderPageMarkdown(path, siteUrl),
}));

const { handleAgentRequest, pageForMarkdownPath } = await import(
  "./agent-request"
);

function request(path: string, accept: string | null = null, method = "GET") {
  return handleAgentRequest({
    url: new URL(`https://everr.dev${path}`),
    method,
    accept,
  });
}

beforeEach(() => {
  renderPageMarkdown.mockClear();
});

describe("handleAgentRequest", () => {
  it("leaves a browser request for a real page alone", async () => {
    expect(await request("/", "text/html,*/*;q=0.8")).toBeUndefined();
    expect(await request("/pricing", "text/html")).toBeUndefined();
  });

  it("leaves a wildcard request for a real page alone, so previewers get HTML", async () => {
    expect(await request("/", "*/*")).toBeUndefined();
    expect(await request("/", null)).toBeUndefined();
  });

  it("serves Markdown when the client explicitly asks for it", async () => {
    const response = await request("/about", "text/markdown");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response?.headers.get("vary")).toBe("Accept, Accept-Encoding");
    expect(await response?.text()).toBe("# /about");
  });

  it("serves Markdown for the .md twin of a page", async () => {
    const response = await request("/docs/learn/install.md", "text/html");

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("# /docs/learn/install");
  });

  it("maps /index.md and /docs.md to their index pages", () => {
    expect(pageForMarkdownPath("/index.md")).toBe("/");
    expect(pageForMarkdownPath("/docs.md")).toBe("/docs");
    expect(pageForMarkdownPath("/about.md")).toBe("/about");
    expect(pageForMarkdownPath("/about")).toBeNull();
  });

  it("refuses path traversal in a .md request", () => {
    expect(pageForMarkdownPath("/docs/../secret.md")).toBeNull();
    expect(pageForMarkdownPath("/docs/%2e%2e/secret.md")).toBeNull();
  });

  it("answers a missing page with a Markdown 404 for a plain client", async () => {
    const response = await request("/some-path-that-does-not-exist", "*/*");

    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(await response?.text()).toContain("/some-path-that-does-not-exist");
  });

  it("lets a browser fall through to the rendered 404 page", async () => {
    expect(
      await request("/some-path-that-does-not-exist", "text/html,*/*;q=0.8"),
    ).toBeUndefined();
  });

  it("answers an unknown /api path with a JSON error", async () => {
    const response = await request("/api/v2/whatever", "*/*");

    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    const body = (await response?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("leaves the API routes this site really serves alone", async () => {
    expect(await request("/api/search?q=logs")).toBeUndefined();
    expect(await request("/api/og")).toBeUndefined();
    expect(await request("/api/og/devlog/a-post")).toBeUndefined();
  });

  it("leaves static assets and framework paths alone", async () => {
    expect(await request("/favicon.ico")).toBeUndefined();
    expect(await request("/install.sh")).toBeUndefined();
    expect(await request("/openapi.json")).toBeUndefined();
    expect(await request("/llms.txt")).toBeUndefined();
    expect(await request("/assets/app-1234.js")).toBeUndefined();
    expect(await request("/_serverFn/anything")).toBeUndefined();
  });

  it("leaves non-GET requests alone", async () => {
    expect(await request("/nope", "*/*", "POST")).toBeUndefined();
  });
});
