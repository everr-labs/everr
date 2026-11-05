import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { productUI } from "../app/composition/ui";
import { termsHash } from "./terms";

vi.mock("./terms", () => ({
  termsHash: "a".repeat(64),
  termsUrl: `https://everr.dev/terms?hash=${"a".repeat(64)}`,
}));

function Signup() {
  const policy = productUI.useSignupPolicy();
  return (
    <>
      {policy.notice}
      <output data-testid="signup-data">{JSON.stringify(policy.additionalData)}</output>
      <button type="button" disabled={!policy.canSubmit}>
        Email signup
      </button>
      <button type="button" disabled={!policy.canSubmit}>
        Google signup
      </button>
    </>
  );
}

it("requires an unchecked, explicit Terms agreement for either signup method", async () => {
  const user = userEvent.setup();
  render(<Signup />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Email signup" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Google signup" })).toBeDisabled();
  expect(screen.getByTestId("signup-data")).toBeEmptyDOMElement();
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    `https://everr.dev/terms?hash=${termsHash}`,
  );
  expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute(
    "href",
    "https://everr.dev/privacy",
  );
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Email signup" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Google signup" })).toBeEnabled();
  expect(screen.getByTestId("signup-data")).toHaveTextContent(JSON.stringify({ termsHash }));
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Email signup" })).toBeDisabled();
  expect(screen.getByTestId("signup-data")).toBeEmptyDOMElement();
});
