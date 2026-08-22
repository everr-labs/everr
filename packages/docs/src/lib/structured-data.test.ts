import { describe, expect, it } from "vitest";
import {
  homepageJsonLd,
  jsonLdScript,
  sitewideJsonLd,
} from "./structured-data";

const BASE = "https://everr.dev";

type Node = Record<string, unknown> & { "@type": string };

function node(graph: unknown, type: string): Node {
  const found = (graph as { "@graph": Node[] })["@graph"].find(
    (entry) => entry["@type"] === type,
  );
  if (!found) throw new Error(`no ${type} in the graph`);
  return found;
}

describe("homepage JSON-LD", () => {
  const graph = homepageJsonLd(BASE);

  it("declares the schema.org context and a graph", () => {
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"].length).toBe(3);
  });

  it("identifies the product as a SoftwareApplication with offers", () => {
    const software = node(graph, "SoftwareApplication");

    expect(software.name).toBe("Everr");
    expect(software.url).toBe(`${BASE}/`);
    expect(software.description).toBeTruthy();
    expect(software.applicationCategory).toBe("DeveloperApplication");
    expect((software.offers as unknown[]).length).toBeGreaterThan(0);
  });

  it("identifies the company with contact points and social profiles", () => {
    const organization = node(graph, "Organization");

    expect(organization.name).toBe("Everr Labs");
    expect(organization.email).toBe("hello@everr.dev");
    expect(organization.sameAs).toContain(
      "https://github.com/everr-labs/everr",
    );

    const contactTypes = (
      organization.contactPoint as Array<{ contactType: string }>
    ).map((point) => point.contactType);
    expect(contactTypes).toContain("customer support");
    expect(contactTypes).toContain("security");
  });

  it("links the website to the organization that publishes it", () => {
    const website = node(graph, "WebSite");
    const organization = node(graph, "Organization");

    expect((website.publisher as { "@id": string })["@id"]).toBe(
      organization["@id"],
    );
    expect(website.inLanguage).toBe("en");
  });
});

describe("sitewide JSON-LD", () => {
  it("carries identity without repeating the product claims", () => {
    const graph = sitewideJsonLd(BASE);

    expect(graph["@graph"].map((entry) => entry["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
  });
});

describe("jsonLdScript", () => {
  it("serializes to a script tag the router can render", () => {
    const script = jsonLdScript({ "@context": "https://schema.org" });

    expect(script.type).toBe("application/ld+json");
    expect(JSON.parse(script.children)).toEqual({
      "@context": "https://schema.org",
    });
  });
});
