import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createQueryClient } from "@/lib/query-client";
import { mockCommands } from "@/test-commands";
import { LocalTelemetryGate } from "./collector-status";

const stopped = {
  status: "stopped",
  otlpEndpoint: "http://127.0.0.1:54318",
  sqlEndpoint: "http://127.0.0.1:54320",
  healthEndpoint: "http://127.0.0.1:54320/health",
};

function renderGate() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <LocalTelemetryGate>Telemetry explorer</LocalTelemetryGate>
    </QueryClientProvider>,
  );
}

describe("collector response validation", () => {
  it.each([
    { ...stopped, status: "unknown" },
    { status: "running" },
    { ...stopped, sqlEndpoint: 42 },
  ])("blocks the explorer when collector status is malformed: %j", async (response) => {
    mockCommands(() => response);
    renderGate();
    expect(await screen.findByText("Invalid local response")).toBeInTheDocument();
    expect(screen.queryByText("Telemetry explorer")).not.toBeInTheDocument();
  });

  it("does not cache a malformed restart response as a running collector", async () => {
    mockCommands((command) => (command === "restart_collector" ? { status: "running" } : stopped));
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Restart collector" }));
    expect(await screen.findByText("Invalid local response")).toBeInTheDocument();
    expect(screen.queryByText("Telemetry explorer")).not.toBeInTheDocument();
  });

  it("recovers from an invalid status after a valid restart", async () => {
    let response: unknown = { status: "running" };
    mockCommands((command) => {
      if (command === "restart_collector") response = { ...stopped, status: "running" };
      return response;
    });
    renderGate();
    expect(await screen.findByText("Invalid local response")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart collector" }));
    expect(await screen.findByText("Telemetry explorer")).toBeInTheDocument();
    expect(screen.queryByText("Invalid local response")).not.toBeInTheDocument();
  });
});
