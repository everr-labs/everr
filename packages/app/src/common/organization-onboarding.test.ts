import { expect, it } from "vitest";
import { newAccountDestination } from "./organization-onboarding";

it("sends new accounts through setup and preserves their app destination", () => {
  expect(newAccountDestination()).toBe("/organization-setup?returnTo=%2F");
  expect(
    new URLSearchParams(
      newAccountDestination("/logs?service=api#results").split("?")[1],
    ).get("returnTo"),
  ).toBe("/logs?service=api#results");
});
it.each([
  "/invite/invitation-123",
  "/invite/invitation-123?source=email#confirmation",
  "/device?user_code=ABCD",
  "/organizations/checkout/success?checkout_id=one",
  "/checkout/success?checkout_id=one",
])("preserves the %s continuation before organization setup", (target) => {
  expect(newAccountDestination(target)).toBe(target);
});
it.each([
  "//evil.example",
  "https://evil.example",
  "/invite/\\evil.example",
  "/invite/invitation-123\n",
  "/organization-setup",
  "/create-organization",
])("does not accept an unsafe or looping destination: %s", (target) => {
  expect(newAccountDestination(target)).toBe(
    "/organization-setup?returnTo=%2F",
  );
});

it.each([
  "/invite",
  "/invite/",
  "/invite-other/invitation-123",
])("keeps non-invitation destinations in onboarding: %s", (target) => {
  expect(newAccountDestination(target)).toBe(
    `/organization-setup?${new URLSearchParams({ returnTo: target })}`,
  );
});
