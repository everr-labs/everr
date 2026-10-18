import { expect, it } from "vitest";
import { server } from "./runtime";

it("uses the hosted ingestion endpoint", () => {
  expect(server.getIngestEndpoint()).toBe("https://ingest.everr.dev/");
});
