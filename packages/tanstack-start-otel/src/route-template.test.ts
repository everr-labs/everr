import { describe, expect, it } from "vitest";
import { routeTemplate } from "./route-template.js";

const matcher = {
  matchRoutes: (pathname: string) =>
    pathname === "/repos/abc123"
      ? [
          { routeId: "__root__", fullPath: "/" },
          { routeId: "/_authenticated", fullPath: "/" },
          {
            routeId: "/_authenticated/repos/$repoId",
            fullPath: "/repos/$repoId",
          },
        ]
      : [{ routeId: "__root__", fullPath: "/" }],
};

describe("routeTemplate", () => {
  it("returns the full path of the deepest match, without pathless segments", () => {
    expect(routeTemplate(matcher, "/repos/abc123")).toBe("/repos/$repoId");
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
