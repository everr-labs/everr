import { expect, it } from "vitest";
import { validateOutboundUrl } from "./outbound";

async function rejection(raw: string): Promise<string> {
  return validateOutboundUrl(raw).then(
    () => "resolved",
    (error: unknown) => (error as Error).message,
  );
}

// The WHATWG parser keeps the brackets on a v6 literal, so an unstripped
// hostname skips the blocklist and reaches a DNS lookup instead. That fails
// closed today, which is why the wrong answer is what this pins: the reason
// has to say the address is internal, or the next refactor loses the block.
it("names an IPv6 loopback literal as internal, not as an unknown host", async () => {
  expect(await rejection("http://[::1]/hook")).toContain("internal address");
});

it("sees through a v4-mapped IPv6 literal", async () => {
  expect(await rejection("http://[0:0:0:0:0:ffff:127.0.0.1]/hook")).toContain(
    "internal address",
  );
});

it("blocks the gateway prefixes that carry a v4 address", async () => {
  // NAT64 and 6to4: on a network with either gateway these reach 127.0.0.1.
  expect(await rejection("http://[64:ff9b::7f00:1]/hook")).toContain(
    "internal address",
  );
  expect(await rejection("http://[2002:7f00:1::]/hook")).toContain(
    "internal address",
  );
});

it("still allows a public literal", async () => {
  await expect(validateOutboundUrl("https://8.8.8.8/hook")).resolves.toEqual(
    new URL("https://8.8.8.8/hook"),
  );
});
