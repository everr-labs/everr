// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { githubRepoFromName, githubRepoFromUrl } from "./infer";

describe("githubRepoFromUrl", () => {
  it("reads owner/name from every form a repository URL takes", () => {
    for (const url of [
      "https://github.com/acme/api",
      "https://github.com/acme/api.git",
      "https://github.com/acme/api/",
      "git@github.com:acme/api.git",
      "ssh://git@github.com/acme/api",
    ]) {
      expect(githubRepoFromUrl(url)).toBe("acme/api");
    }
  });

  it("ignores repositories that are not on GitHub", () => {
    expect(githubRepoFromUrl("https://gitlab.com/acme/api")).toBeNull();
    expect(githubRepoFromUrl("not a url")).toBeNull();
  });
});

describe("githubRepoFromName", () => {
  const known = ["acme/api", "acme/web", "other/web"];

  it("takes owner/name as it is", () => {
    expect(githubRepoFromName("acme/billing", known)).toBe("acme/billing");
  });

  it("matches a bare name to the one repository Everr knows by it", () => {
    expect(githubRepoFromName("API", known)).toBe("acme/api");
  });

  it("matches nothing when two repositories share the name", () => {
    expect(githubRepoFromName("web", known)).toBeNull();
    expect(githubRepoFromName("billing", known)).toBeNull();
  });
});
