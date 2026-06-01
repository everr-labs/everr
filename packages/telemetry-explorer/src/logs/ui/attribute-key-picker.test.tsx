import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import { AttributeKeyPicker } from "./attribute-key-picker";

const timeRange = { from: "now-1h", to: "now" };

function renderPicker(
  activeKeys?: ReadonlySet<string>,
  keys: { source: string; key: string }[] = [
    { source: "resource", key: "vcs.repository.name" },
    { source: "log", key: "custom.unknown.thing" },
  ],
) {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue(keys),
  } as unknown as LogsRepositoryLike;
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeKeyPicker
        repo={repo}
        timeRange={timeRange}
        activeKeys={activeKeys}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("AttributeKeyPicker", () => {
  it("pins promoted attributes under a Suggested group", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));

    expect(await screen.findByText("Suggested")).toBeInTheDocument();
    // Promoted "Repository" shows its friendly name + raw key under Suggested.
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
    // Wait for the query to resolve via a still-present item.
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

  it("hides service.name since it has a dedicated Service filter", async () => {
    renderPicker(undefined, [
      { source: "resource", key: "service.name" },
      { source: "log", key: "custom.unknown.thing" },
    ]);
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
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
