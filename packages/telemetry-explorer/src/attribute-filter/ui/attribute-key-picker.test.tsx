import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeSource } from "../schemas";
import { AttributeKeyPicker } from "./attribute-key-picker";
import type { PromotedAttribute } from "./attribute-meta";

const timeRange = { from: "now-1h", to: "now" };
const PROMOTED: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
];
const EXCLUDED = new Set(["resource:service.name"]);
const SOURCES: AttributeSource[] = ["resource", "log", "scope"];

function renderPicker(
  activeKeys?: ReadonlySet<string>,
  keys: { source: string; key: string }[] = [
    { source: "resource", key: "vcs.repository.name" },
    { source: "log", key: "custom.unknown.thing" },
  ],
) {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue(keys),
  } as unknown as AttributeRepositoryLike;
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeKeyPicker
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        activeKeys={activeKeys}
        promotedAttributes={PROMOTED}
        excludedKeys={EXCLUDED}
        sources={SOURCES}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("AttributeKeyPicker", () => {
  it("pins in-range promoted attributes under a Suggested group", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("Suggested")).toBeInTheDocument();
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("vcs.repository.name")).toBeInTheDocument();
  });

  it("shows discovered non-promoted keys (raw key when unknown)", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("custom.unknown.thing")).toBeInTheDocument();
  });

  it("hides keys that are already active", async () => {
    renderPicker(new Set(["resource:vcs.repository.name"]));
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });

  it("omits promoted attributes absent from the discovered range", async () => {
    renderPicker(undefined, [{ source: "log", key: "custom.unknown.thing" }]);
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });

  it("hides excluded keys (service.name)", async () => {
    renderPicker(undefined, [
      { source: "resource", key: "service.name" },
      { source: "log", key: "custom.unknown.thing" },
    ]);
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("service.name")).not.toBeInTheDocument();
  });

  it("does not suggest a promoted key that also has a dedicated filter", async () => {
    const repo = {
      // Discovered and promoted, but also excluded by a top-level filter.
      attributeKeys: vi
        .fn()
        .mockResolvedValue([{ source: "resource", key: "service.name" }]),
    } as unknown as AttributeRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AttributeKeyPicker
          repo={repo}
          domain="logs"
          timeRange={timeRange}
          promotedAttributes={[{ source: "resource", key: "service.name" }]}
          excludedKeys={new Set(["resource:service.name"])}
          sources={SOURCES}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("No attributes.")).toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.queryByText("service.name")).not.toBeInTheDocument();
  });

  it("shows the empty state when the range has no attributes", async () => {
    renderPicker(undefined, []);
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("No attributes.")).toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("matches a known item when searching by its raw key", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("Repository");
    fireEvent.change(screen.getByPlaceholderText("Search attributes..."), {
      target: { value: "vcs.repository" },
    });
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.queryByText("custom.unknown.thing")).not.toBeInTheDocument();
  });
});
