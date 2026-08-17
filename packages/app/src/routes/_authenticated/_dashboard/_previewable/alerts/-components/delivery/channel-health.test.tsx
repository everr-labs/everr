import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelHealthLine } from "./channel-health";

const base = {
  channel: "team-slack",
  delivered: 0,
  failed: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: "",
};

describe("ChannelHealthLine", () => {
  it("says nothing about a channel nothing was ever sent through", () => {
    const { container } = render(<ChannelHealthLine health={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the failure without reprinting the page the endpoint answered with", () => {
    render(
      <ChannelHealthLine
        health={{
          ...base,
          failed: 3,
          lastFailureAt: "2026-08-17T11:00:00.000Z",
          lastError:
            'notification webhook failed: 405 <!doctype html><html lang="en"><head><title>Example Domain</title></head></html>',
        }}
      />,
    );
    expect(
      screen.getByText(
        "3 deliveries failed in 24h: notification webhook failed: 405",
      ),
    ).toBeInTheDocument();
  });
});
