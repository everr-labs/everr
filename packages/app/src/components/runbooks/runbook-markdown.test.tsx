import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

// Render TanStack's <Link> as a plain anchor that surfaces its props, so we can
// assert what RunbookAnchor forwards (to, hash, and spread attrs like title).
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    hash,
    children,
    ...rest
  }: {
    to: string;
    params?: { _splat?: string };
    hash?: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a
      data-link="internal"
      data-to={to}
      data-splat={params?._splat ?? ""}
      data-hash={hash ?? ""}
      {...rest}
    >
      {children}
    </a>
  ),
}));

// Stub the panel embed (pulls in DB-backed dashboard code), showing the
// source it was given.
vi.mock("./runbook-panel-embed", () => ({
  PanelEmbedBlock: ({ source }: { source: string }) => <output>{source}</output>,
}));

import { RunbookMarkdown } from "./runbook-markdown";

// Mirror the real resolver: strip any #fragment/?query before matching a page.
const resolveLink = (href: string) =>
  href.replace(/[#?].*$/, "") === "./traffic.md" ? "traffic" : null;

function renderRunbook(markdown: string) {
  return render(
    <RunbookMarkdown markdown={markdown} project="demo" slug="rb" resolveLink={resolveLink} />,
  );
}

describe("RunbookMarkdown anchors", () => {
  it("opens external links in a new tab with a safe rel and keeps the title", () => {
    const { container } = renderRunbook('[ext](https://example.com "Ext")');
    const a = container.querySelector("a:not([data-link])") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe("Ext");
  });

  it("renders a resolved in-runbook link as a router Link and forwards the title", () => {
    const { container } = renderRunbook('[Traffic](./traffic.md "Go")');
    const link = container.querySelector('[data-link="internal"]');
    expect(link?.getAttribute("data-to")).toBe("/runbooks/$project/$slug/$");
    expect(link?.getAttribute("data-splat")).toBe("traffic");
    // title from `[text](url "title")` must survive on internal links too.
    expect(link?.getAttribute("title")).toBe("Go");
  });

  it("keeps the fragment on a resolved internal link", () => {
    const { container } = renderRunbook("[Errors](./traffic.md#errors)");
    const link = container.querySelector('[data-link="internal"]');
    expect(link?.getAttribute("data-hash")).toBe("errors");
  });

  it("leaves hash-only links as in-place anchors (no new tab)", () => {
    const { container } = renderRunbook("[Top](#section)");
    const a = container.querySelector("a:not([data-link])") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("#section");
    expect(a.getAttribute("target")).toBeNull();
  });

  it("does not leak react-markdown's `node` prop onto the DOM", () => {
    const { container } = renderRunbook("[ext](https://example.com)");
    const a = container.querySelector("a:not([data-link])") as HTMLAnchorElement;
    expect(a.getAttribute("node")).toBeNull();
  });
});

describe("RunbookMarkdown code blocks", () => {
  it("highlights a fence in a known language and leaves others plain", () => {
    const { container } = renderRunbook(
      "```sql\nSELECT 1\n```\n\n```\nSELECT 1\n```\n\n```cobol\nSELECT 1\n```",
    );
    const blocks = [...container.querySelectorAll("pre code")];
    expect(blocks.map((code) => code.querySelector(".hljs-keyword")?.textContent ?? null)).toEqual([
      "SELECT",
      null,
      null,
    ]);
  });

  it("highlights a language outside the common set once its grammar loads", async () => {
    // Inside act, so React retries the block once the grammars have loaded.
    const { container } = await act(async () => renderRunbook("```rust\nfn main() {}\n```"));
    await waitFor(() =>
      expect(container.querySelector("pre .hljs-keyword")?.textContent).toBe("fn"),
    );
    // Named by its grammar, not as the fence wrote it.
    expect(container.querySelector("figcaption span")?.textContent).toBe("Rust");
  });

  it("hands a panel fence to the embed as its raw source", () => {
    const { container } = renderRunbook("```panel\nref: errors\n```");
    expect(container.querySelector("output")?.textContent).toBe("ref: errors\n");
  });
});

describe("RunbookMarkdown code block header", () => {
  it("names the language and copies the code without its trailing newline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, "clipboard");
    });
    renderRunbook("```sql\nSELECT 1\n```\n\n    plain");

    expect(
      screen.getAllByRole("figure").map((f) => f.querySelector("figcaption span")?.textContent),
    ).toEqual(["SQL", "Text"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy code" })[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("SELECT 1"));
    expect(screen.getAllByRole("button", { name: "Copied" })).toHaveLength(1);
  });
});

describe("RunbookMarkdown blocks", () => {
  it("gives headings ids to link to, numbering repeated titles", () => {
    const { container } = renderRunbook("## Roll back\n\n## Roll back\n\n### Why? (rarely)");
    expect([...container.querySelectorAll("h2, h3")].map((h) => h.id)).toEqual([
      "roll-back",
      "roll-back-1",
      "why-rarely",
    ]);
  });

  it("renders GitHub alert quotes as callouts and plain quotes as quotes", () => {
    const { container } = renderRunbook("> [!WARNING]\n> Drain the node first.\n\n> Just a quote.");
    const callout = container.querySelector("aside[data-callout='warning']");
    expect(callout).toHaveTextContent(/^Warning\s*Drain the node first\.$/);
    expect(callout).not.toHaveTextContent("[!WARNING]");
    expect(container.querySelector("blockquote")).toHaveTextContent("Just a quote.");
  });

  it("renders the allowed bare tags and shows any other HTML as text", () => {
    const { container } = renderRunbook(
      "Press <kbd>Ctrl</kbd>, <script>alert(1)</script> <b>bold</b>\n\n<details>\n<summary>More</summary>\n\nHidden.\n\n</details>",
    );
    expect(container.querySelector("kbd")).toHaveTextContent("Ctrl");
    expect(container.querySelector("script, b")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container.querySelector("details > summary")).toHaveTextContent("More");
    expect(container.querySelector("details")).toHaveTextContent("Hidden.");
  });

  it("marks external links and loads images lazily, zooming them unless linked", () => {
    const { container } = renderRunbook(
      "[docs](https://example.com) ![chart](/a.png) [![logo](/b.png)](https://example.com)",
    );
    expect(screen.getAllByLabelText("(opens in a new tab)")).toHaveLength(1);
    expect(
      [...container.querySelectorAll("img")].map((img) => img.getAttribute("loading")),
    ).toEqual(["lazy", "lazy"]);
    expect(screen.getAllByRole("button", { name: /full size/ })).toHaveLength(1);
  });

  it("titles a block, marks its lines and copies a shell session's commands alone", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, "clipboard");
    });
    const { container } = renderRunbook(
      '```console title="deploy.sh" {2}\n$ kubectl apply -f app.yaml\ndeployment configured\n$ kubectl rollout status deploy/app\n```',
    );

    expect(container.querySelector("figcaption span")).toHaveTextContent("deploy.sh");
    expect(
      [...container.querySelectorAll(".code-line")].map((line) => line.hasAttribute("data-marked")),
    ).toEqual([false, true, false]);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "kubectl apply -f app.yaml\nkubectl rollout status deploy/app",
      ),
    );
  });
});
