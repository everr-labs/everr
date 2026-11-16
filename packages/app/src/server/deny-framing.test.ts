import { describe, expect, it } from "vite-plus/test";
import { denyFraming } from "./deny-framing";

const through = (response: Response) =>
  denyFraming(async () => ({ response })).then((result) => result.response);

describe("denyFraming", () => {
  it("forbids framing on a normal response", async () => {
    const response = await through(new Response("<html></html>"));

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("lets a redirect through", async () => {
    const response = await through(Response.redirect("https://example.com/", 302));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/");
  });
});
