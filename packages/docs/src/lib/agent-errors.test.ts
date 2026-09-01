import { describe, expect, it } from "vitest";
import { agentNotFoundResponse, notFoundMarkdown } from "./agent-errors";

const SITE = "https://everr.dev";

describe("agentNotFoundResponse", () => {
  it("lets a browser fall through to the rendered 404 page", () => {
    expect(
      agentNotFoundResponse("text/html,*/*;q=0.8", SITE, "/nope"),
    ).toBeNull();
  });

  it("answers a plain client with a 404 and a Markdown body", async () => {
    const response = agentNotFoundResponse("*/*", SITE, "/nope");

    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response?.headers.get("vary")).toBe("Accept, Accept-Encoding");

    const body = await response?.text();
    expect(body).toContain("/nope");
    expect(body).toContain("https://everr.dev/llms.txt");
    expect(body).toContain("https://everr.dev/sitemap.xml");
    expect(body).toContain("https://everr.dev/openapi.json");
  });

  it("answers a JSON client with a structured error", async () => {
    const response = agentNotFoundResponse("application/json", SITE, "/nope");

    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    const body = (await response?.json()) as {
      error: { code: string; status: number; documentation_url: string };
    };
    expect(body.error.code).toBe("not_found");
    expect(body.error.status).toBe(404);
    expect(body.error.documentation_url).toBe("https://everr.dev/docs");
  });

  it("answers 406 when the client accepts nothing we serve", async () => {
    const response = agentNotFoundResponse("image/png", SITE, "/nope");

    expect(response?.status).toBe(406);

    const body = (await response?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_acceptable");
  });
});

describe("notFoundMarkdown", () => {
  it("names the path and every machine-readable entry point", () => {
    const markdown = notFoundMarkdown(SITE, "/missing/page");

    expect(markdown).toContain("# 404 Not Found");
    expect(markdown).toContain("`/missing/page`");
    for (const path of [
      "/llms.txt",
      "/sitemap.xml",
      "/openapi.json",
      "/docs",
      "/docs.md",
    ]) {
      expect(markdown).toContain(`${SITE}${path}`);
    }
  });
});
