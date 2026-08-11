import { describe, expect, it } from "vitest";
import { routeTemplate } from "./route-template";

const matcher = {
  matchRoutes: (pathname: string) =>
    pathname === "/repos/abc123"
      ? [
          { routeId: "__root__" },
          { routeId: "/_authenticated" },
          { routeId: "/_authenticated/repos/$repoId" },
        ]
      : [{ routeId: "__root__" }],
};

describe("routeTemplate", () => {
  it("returns the deepest matched route id", () => {
    expect(routeTemplate(matcher, "/repos/abc123")).toBe(
      "/_authenticated/repos/$repoId",
    );
  });

  it("parameterizes server function paths without consulting the tree", () => {
    expect(routeTemplate(matcher, "/_serverFn/c4d3d0c28997f144965eeaca")).toBe(
      "/_serverFn/:id",
    );
  });

  it("returns undefined for a path only the root matches", () => {
    expect(routeTemplate(matcher, "/wp-login.php")).toBeUndefined();
  });
});
