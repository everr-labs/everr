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

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });
  return writeText;
}

describe("RunbookMarkdown anchors", () => {
  it("opens external links in a new tab, marked, with a safe rel and the title", () => {
    const { container } = renderRunbook('[ext](https://example.com "Ext")');
    const a = container.querySelector("a:not([data-link])");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("title")).toBe("Ext");
    expect(a?.hasAttribute("node")).toBe(false);
    expect(screen.getByLabelText("(opens in a new tab)")).toBeInTheDocument();
  });

  it("renders a resolved in-runbook link as a router Link, keeping its title and fragment", () => {
    const { container } = renderRunbook('[Traffic](./traffic.md#errors "Go")');
    const link = container.querySelector('[data-link="internal"]');
    expect(link?.getAttribute("data-to")).toBe("/runbooks/$project/$slug/$");
    expect(link?.getAttribute("data-splat")).toBe("traffic");
    expect(link?.getAttribute("data-hash")).toBe("errors");
    expect(link?.getAttribute("title")).toBe("Go");
  });

  it("leaves hash-only and mailto links in place, unmarked", () => {
    const { container } = renderRunbook("[Top](#section) <oncall@example.com>");
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "#section",
      "mailto:oncall@example.com",
    ]);
    expect(anchors.map((a) => a.getAttribute("target"))).toEqual([null, null]);
    expect(screen.queryByLabelText("(opens in a new tab)")).toBeNull();
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

  it("heads each block with its title or language, marks lines and copies the code", async () => {
    const writeText = stubClipboard();
    renderRunbook(
      '```sql\nSELECT 1\n```\n\n    plain\n\n```console title="deploy.sh" {2}\n$ kubectl apply -f app.yaml\ndeployment configured\n$ kubectl rollout status deploy/app\n```',
    );

    const figures = screen.getAllByRole("figure");
    expect(figures.map((f) => f.querySelector("figcaption span")?.textContent)).toEqual([
      "SQL",
      "Text",
      "deploy.sh",
    ]);
    expect(
      [...(figures[2]?.querySelectorAll("pre code > span") ?? [])].map((line) =>
        line.hasAttribute("data-marked"),
      ),
    ).toEqual([false, true, false]);

    const [sql, , session] = screen.getAllByRole("button", { name: "Copy code" });
    // Without the fence's trailing newline.
    fireEvent.click(sql!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("SELECT 1"));
    expect(screen.getAllByRole("button", { name: "Copied" })).toHaveLength(1);
    // A shell session's commands alone, without prompts or output.
    fireEvent.click(session!);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        "kubectl apply -f app.yaml\nkubectl rollout status deploy/app",
      ),
    );
  });

  it("hands a panel fence to the embed as its raw source", () => {
    const { container } = renderRunbook("```panel\nref: errors\n```");
    expect(container.querySelector("output")?.textContent).toBe("ref: errors\n");
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
      "Press <kbd>Ctrl</kbd>, <script>alert(1)</script> <b>bold</b>\n\n<details>\n<summary>a -> <i>b</i></summary>\n\nHidden.\n\n</details>",
    );
    expect(container.querySelector("kbd")).toHaveTextContent("Ctrl");
    expect(container.querySelector("script, b, i")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container.querySelector("details > summary")).toHaveTextContent("a -> <i>b</i>");
    expect(container.querySelector("details")).toHaveTextContent("Hidden.");
  });

  it("loads images lazily, zooming them unless linked", () => {
    const { container } = renderRunbook("![chart](/a.png) [![logo](/b.png)](https://example.com)");
    // A linked image needs no new-tab arrow beside it.
    expect(screen.queryByLabelText("(opens in a new tab)")).toBeNull();
    expect(
      [...container.querySelectorAll("img")].map((img) => img.getAttribute("loading")),
    ).toEqual(["lazy", "lazy"]);
    expect(screen.getAllByRole("button", { name: /full size/ })).toHaveLength(1);
  });
});
