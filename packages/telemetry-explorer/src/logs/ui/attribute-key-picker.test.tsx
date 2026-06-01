import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import { AttributeKeyPicker } from "./attribute-key-picker";

// base-ui popover/positioner may reference ResizeObserver, which jsdom lacks.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const timeRange = { from: "now-1h", to: "now" };

function renderPicker() {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue([
      { source: "resource", key: "vcs.repository.name" },
      { source: "log", key: "custom.unknown.thing" },
    ]),
  } as unknown as LogsRepositoryLike;
  const client = new QueryClient();
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AttributeKeyPicker
        repo={repo}
        timeRange={timeRange}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("AttributeKeyPicker", () => {
  it("shows a friendly name + raw key for known attributes and the raw key alone for unknown ones", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Add filter"));

    // Known attribute: friendly label as the primary line, raw key as subtext.
    expect(await screen.findByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("vcs.repository.name")).toBeInTheDocument();

    // Unknown attribute: only the raw key is shown.
    expect(screen.getByText("custom.unknown.thing")).toBeInTheDocument();
  });

  it("matches a known item when searching by its raw key", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Add filter"));
    await screen.findByText("Repository");

    fireEvent.change(screen.getByPlaceholderText("Search attributes..."), {
      target: { value: "vcs.repository" },
    });

    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.queryByText("custom.unknown.thing")).not.toBeInTheDocument();
  });
});
