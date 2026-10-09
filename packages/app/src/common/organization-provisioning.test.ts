import { expect, it } from "vitest";
import { isOrganizationProvisioned } from "./organization-provisioning";

it.each([
  null,
  undefined,
  "{}",
  {},
  { label: "legacy" },
])("keeps legacy organizations without provisioning state ready: %j", (metadata) =>
  expect(isOrganizationProvisioned(metadata)).toBe(true));
it.each([
  { clickhouseReady: false },
  JSON.stringify({ clickhouseReady: false, label: "pending" }),
])("reads pending state from stored or API metadata: %j", (metadata) => {
  expect(isOrganizationProvisioned(metadata)).toBe(false);
});
