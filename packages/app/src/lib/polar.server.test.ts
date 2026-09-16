import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { POLAR_ACCESS_TOKEN: "test", POLAR_SERVER: "sandbox" },
}));

import { getPolarCheckoutSubscription, polarClient } from "./polar.server";

afterEach(() => vi.restoreAllMocks());
function pages(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { result: { items } };
    },
  };
}
describe("Polar checkout subscriptions", () => {
  it("uses the subscription ID returned by the checkout when available", async () => {
    const subscription = {
      id: "subscription_1",
      checkoutId: "checkout_1",
      customerId: "customer_1",
      productId: "product_1",
    };
    const get = vi
      .spyOn(polarClient.subscriptions, "get")
      .mockResolvedValue(subscription as never);
    const list = vi.spyOn(polarClient.subscriptions, "list");

    await expect(
      getPolarCheckoutSubscription({
        id: "checkout_1",
        subscriptionId: "subscription_1",
        customerId: "customer_1",
        productId: "product_1",
      }),
    ).resolves.toBe(subscription);

    expect(get).toHaveBeenCalledWith({ id: "subscription_1" });
    expect(list).not.toHaveBeenCalled();
  });

  it("recovers the subscription through its checkout ID", async () => {
    const subscription = {
      id: "subscription_1",
      checkoutId: "checkout_1",
      customerId: "customer_1",
      productId: "product_1",
    };
    const list = vi
      .spyOn(polarClient.subscriptions, "list")
      .mockResolvedValue(pages([subscription]) as never);

    await expect(
      getPolarCheckoutSubscription({
        id: "checkout_1",
        subscriptionId: null,
        customerId: "customer_1",
        productId: "product_1",
      }),
    ).resolves.toBe(subscription);

    expect(list).toHaveBeenCalledWith({
      customerId: "customer_1",
      productId: "product_1",
      active: true,
      limit: 100,
    });
  });

  it("does not accept another active subscription for the same product", async () => {
    vi.spyOn(polarClient.subscriptions, "list").mockResolvedValue(
      pages([{ id: "subscription_old", checkoutId: "checkout_old" }]) as never,
    );

    await expect(
      getPolarCheckoutSubscription({
        id: "checkout_1",
        subscriptionId: null,
        customerId: "customer_1",
        productId: "product_1",
      }),
    ).resolves.toBeNull();
  });
});

it("rejects a directly referenced subscription belonging to another customer", async () => {
  vi.spyOn(polarClient.subscriptions, "get").mockResolvedValue({
    id: "sub",
    checkoutId: "checkout",
    customerId: "other",
    productId: "pro",
  } as never);
  await expect(
    getPolarCheckoutSubscription({
      id: "checkout",
      subscriptionId: "sub",
      customerId: "expected",
      productId: "pro",
    }),
  ).resolves.toBeNull();
});
