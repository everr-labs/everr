import { expect, it } from "vite-plus/test";
import { returnToSchema } from "./return-to";

it.each([
  "//evil.example",
  "https://evil.example",
  "/invite/\\evil.example",
  "/logs\n",
  "/access-required",
])("rejects unsafe or looping destinations: %s", (target) => {
  expect(returnToSchema.parse(target)).toBe("/");
});

it.each(["/invite/one", "/device?user_code=ABCD", "/logs?service=api#results"])(
  "preserves the original destination: %s",
  (target) => {
    expect(returnToSchema.parse(target)).toBe(target);
  },
);
