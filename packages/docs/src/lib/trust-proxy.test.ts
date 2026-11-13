import { describe, expect, it } from "vite-plus/test";
import { parseTrustProxy } from "./trust-proxy";

describe("TRUST_PROXY", () => {
  it.each([undefined, "", "false", " false "])("trusts no proxy for %j", (value) => {
    expect(parseTrustProxy(value)).toBe(false);
  });

  it("trusts every proxy for true", () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  it("trusts a proxy on the same host for loopback", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
  });

  it("trusts the listed proxy addresses", () => {
    expect(parseTrustProxy("10.0.0.5, fd00::1")).toEqual(["10.0.0.5", "fd00::1"]);
  });

  it.each(["yes", "1", "10.0.0.0/8", "10.0.0.5,"])("refuses %j", (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
  });
});
