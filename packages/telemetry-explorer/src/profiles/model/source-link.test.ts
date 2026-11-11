import { describe, expect, it } from "vite-plus/test";
import { sourceLink } from "./source-link";

const source = { repository: "https://github.com/acme/api.git", revision: "4f2c9e1" };

describe("sourceLink", () => {
  it("links a repo-relative file at the profiled revision and line", () => {
    expect(sourceLink(source, "src/server/orders.ts", 42)).toBe(
      "https://github.com/acme/api/blob/4f2c9e1/src/server/orders.ts#L42",
    );
  });

  it("leaves the line off when it is unknown", () => {
    expect(sourceLink(source, "./main.go", 0)).toBe(
      "https://github.com/acme/api/blob/4f2c9e1/main.go",
    );
  });

  it.each([
    ["an absolute path", "/srv/app/src/server.ts"],
    ["a path that leaves the repository", "src/../../etc/passwd"],
    ["a URL", "file:///srv/app/server.ts"],
    ["a Node built-in", "node:internal/timers"],
    ["a Windows drive path", "C:\\app\\server.ts"],
  ])("does not link %s", (_, file) => {
    expect(sourceLink(source, file, 1)).toBeUndefined();
  });

  it("does not link without an http(s) repository and a revision", () => {
    expect(
      sourceLink({ repository: "git@github.com:acme/api.git", revision: "4f2c9e1" }, "a.ts", 1),
    ).toBeUndefined();
    expect(sourceLink({ ...source, revision: "" }, "a.ts", 1)).toBeUndefined();
    expect(sourceLink(undefined, "a.ts", 1)).toBeUndefined();
  });
});
