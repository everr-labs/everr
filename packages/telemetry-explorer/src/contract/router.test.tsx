import { screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { renderExplore } from "../testing/explore";

it("mounts the shell and carries the time range and filters on its links", async () => {
  const { router } = renderExplore(`/?from=now-1h&service=${encodeURIComponent('["api"]')}`);

  expect(await screen.findByRole("banner")).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ from: "now-1h", service: ["api"] });
  const home = new URL(screen.getByRole<HTMLAnchorElement>("link", { name: /everr/ }).href);
  expect(home.pathname).toBe("/");
  expect(home.searchParams.get("from")).toBe("now-1h");
  expect(home.searchParams.get("service")).toBe('["api"]');
});
