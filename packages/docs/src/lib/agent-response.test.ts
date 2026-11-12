import { describe, expect, it } from "vite-plus/test";
import { respond } from "./agent-response";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

function page(status: number, headers: Record<string, string> = {}) {
  return async (request: Request) =>
    new Response(`<html>${request.headers.get("accept")}</html>`, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
}

const markdownFor = async (pathname: string) =>
  pathname === "/about" ? "# About Everr" : undefined;

function get(path: string, accept?: string, method = "GET") {
  return new Request(`https://everr.dev${path}`, {
    method,
    headers: accept ? { accept } : {},
  });
}

describe("page responses", () => {
  it("serves Markdown to clients that ask for it", async () => {
    const response = await respond(get("/about", "text/markdown"), "/about", {
      render: page(200),
      markdownFor,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(await response.text()).toBe("# About Everr");
  });

  it("serves HTML to browsers with Accept added to Vary", async () => {
    const response = await respond(get("/about", BROWSER), "/about", {
      render: page(200, { vary: "Accept-Encoding" }),
      markdownFor,
    });

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
  });

  it("falls back to HTML when a page has no Markdown and the client accepts HTML", async () => {
    const response = await respond(get("/pricing", "text/markdown, text/html"), "/pricing", {
      render: page(200),
      markdownFor,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("answers 406 with the available types when the client accepts neither", async () => {
    const response = await respond(get("/about", "application/json"), "/about", {
      render: page(200),
      markdownFor,
    });

    expect(response.status).toBe(406);
    expect(await response.text()).toContain("Available: text/html, text/markdown");
  });

  it("answers 404 with a Markdown body to agents", async () => {
    const response = await respond(get("/missing", "*/*"), "/missing", {
      render: page(404),
      markdownFor,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/sitemap.xml");
  });

  it("answers 404 with the HTML page to browsers", async () => {
    const response = await respond(get("/missing", BROWSER), "/missing", {
      render: page(404),
      markdownFor,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("sends no body for HEAD", async () => {
    const response = await respond(get("/about", "text/markdown", "HEAD"), "/about", {
      render: page(200),
      markdownFor,
    });

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("redirects a trailing-slash path instead of answering it in Markdown", async () => {
    // The server strips the trailing slash from the pathname along with the locale prefix
    const response = await respond(get("/about/", "text/markdown"), "/about", {
      render: async () => new Response(null, { status: 307, headers: { location: "/about" } }),
      markdownFor,
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/about");
  });

  it("passes redirects and files from server routes through whatever the client accepts", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://s3/x" } });
    const response = await respond(
      get("/everr-app/release-metadata.json", "application/json"),
      "/everr-app/release-metadata.json",
      { render: async () => redirect, markdownFor },
    );

    expect(response).toBe(redirect);
  });

  it("hands the app the original request when it can render it", async () => {
    const request = get("/about", BROWSER);
    let rendered: Request | undefined;
    await respond(request, "/about", {
      render: async (r) => {
        rendered = r;
        return page(200)(r);
      },
      markdownFor,
    });

    expect(rendered).toBe(request);
  });

  it("leaves API routes to the app", async () => {
    const original = new Response("{}", { headers: { "content-type": "application/json" } });
    const response = await respond(get("/api/search", "application/json"), "/api/search", {
      render: async () => original,
      markdownFor,
    });

    expect(response).toBe(original);
  });

  // The node server passes srvx's NodeRequest, which is not an instance of the global
  // Request. A Markdown-only Accept is the case where the request has to be rebuilt
  it("renders requests that only look like a Request", async () => {
    const request = {
      url: "https://everr.dev/pricing",
      method: "GET",
      headers: new Headers({ accept: "text/markdown" }),
      signal: new AbortController().signal,
    } as unknown as Request;
    let rendered: Request | undefined;

    const response = await respond(request, "/pricing", {
      render: async (r) => {
        rendered = r;
        return page(200)(r);
      },
      markdownFor,
    });

    expect(rendered?.headers.get("accept")).toBe("text/html");
    expect(response.status).toBe(406);
  });

  it("keeps a server error's status whatever the client accepts", async () => {
    const response = await respond(get("/about", "application/json"), "/about", {
      render: page(500),
      markdownFor,
    });

    expect(response.status).toBe(500);
  });

  it("does not answer a path with an empty segment in Markdown", async () => {
    const response = await respond(get("//about", "text/markdown"), "/about", {
      render: async () => new Response(null, { status: 308, headers: { location: "/about" } }),
      markdownFor,
    });

    expect(response.status).toBe(308);
  });
});
