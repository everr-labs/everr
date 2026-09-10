import { describe, expect, it } from "vitest";
import { buildPostAuthenticationURL } from "./auth-page";

describe("buildPostAuthenticationURL", () => {
  it("lands new accounts on home by default", () => {
    expect(buildPostAuthenticationURL()).toBe("/");
  });

  it("preserves an explicit authentication destination", () => {
    expect(buildPostAuthenticationURL("/device?user_code=ABCD")).toBe(
      "/device?user_code=ABCD",
    );
  });
});
