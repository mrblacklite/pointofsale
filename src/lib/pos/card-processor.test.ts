import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chargeCard } from "./card-processor.ts";

const prev = process.env.STRIPE_SECRET_KEY;

describe("chargeCard simulated", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  });

  it("rejects non-positive amounts", async () => {
    await assert.rejects(
      () => chargeCard({ amountCents: 0, currency: "USD", storeName: "Till" }),
      /positive integer/,
    );
  });

  it("captures a simulated card and reads last4 from the token", async () => {
    const r = await chargeCard({
      amountCents: 1100,
      currency: "USD",
      storeName: "Till",
      cardToken: "tok_sim_4242",
    });
    assert.equal(r.processor, "simulated");
    assert.equal(r.status, "captured");
    assert.equal(r.last4, "4242");
    assert.match(r.processorRef, /^sim_/);
  });

  it("declines tokens that look like failures", async () => {
    await assert.rejects(
      () =>
        chargeCard({
          amountCents: 100,
          currency: "USD",
          storeName: "Till",
          cardToken: "tok_fail_0000",
        }),
      /declined/i,
    );
  });
});
