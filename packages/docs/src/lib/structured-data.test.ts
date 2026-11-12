import { describe, expect, it } from "vite-plus/test";
import { jsonLdScript, siteStructuredData } from "./structured-data";

describe("structured data", () => {
  it("describes the organization with a way to contact it", () => {
    const organization = siteStructuredData()["@graph"].find(
      (node) => node["@type"] === "Organization",
    );

    expect(organization).toMatchObject({
      name: "Everr",
      url: "https://everr.dev",
      email: "hello@everr.dev",
      contactPoint: [{ "@type": "ContactPoint", email: "hello@everr.dev" }],
    });
  });

  it("describes the product with its plans", () => {
    const software = siteStructuredData()["@graph"].find(
      (node) => node["@type"] === "SoftwareApplication",
    );

    expect(software?.offers).toEqual(
      expect.arrayContaining([expect.objectContaining({ price: "39", priceCurrency: "EUR" })]),
    );
  });

  it("cannot close its script element", () => {
    const script = jsonLdScript({ name: "</script><script>alert(1)</script>" });

    expect(script.type).toBe("application/ld+json");
    expect(script.children).not.toContain("</script>");
    expect(JSON.parse(script.children)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
