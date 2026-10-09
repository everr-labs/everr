import { expect, it } from "vitest";
import { returnToSchema } from "./return-to";

it.each([
  "//evil.example",
  "https://evil.example",
  "/invite/\\evil.example",
  "/logs\n",
  "/organization-setup",
  "/organization-pending",
  "/choose-organization",
  "/create-organization",
])("rejects unsafe or looping destinations: %s", (target) => {
  expect(returnToSchema.parse(target)).toBe("/");
});

it.each([
  "/invite/one",
  "/device?user_code=ABCD",
  "/organizations/checkout/success?checkout_id=one",
  "/checkout/success?checkout_id=one",
  "/logs?service=api#results",
])("preserves the original destination: %s", (target) => {
  expect(returnToSchema.parse(target)).toBe(target);
});
