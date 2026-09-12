import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDiscount,
  changeDue,
  giftApplied,
  isEmail,
  isPhone,
  paymentCovers,
  ticketTotals,
  tipFromBps,
} from "./pricing.ts";

const cola = { unitPriceCents: 249, quantity: 2, taxExempt: false };
const produce = { unitPriceCents: 199, quantity: 1, taxExempt: true };

describe("applyDiscount", () => {
  it("returns 0 when missing, inactive, or under minimum", () => {
    assert.equal(applyDiscount(1000, null), 0);
    assert.equal(applyDiscount(1000, { type: "percent", value: 10, minSubtotalCents: 0, active: false }), 0);
    assert.equal(applyDiscount(400, { type: "fixed", value: 500, minSubtotalCents: 500, active: true }), 0);
  });

  it("applies percent and caps fixed at subtotal", () => {
    assert.equal(applyDiscount(1000, { type: "percent", value: 10, minSubtotalCents: 0, active: true }), 100);
    assert.equal(applyDiscount(300, { type: "fixed", value: 500, minSubtotalCents: 0, active: true }), 300);
  });

  it("rejects percent over 100", () => {
    assert.throws(
      () => applyDiscount(1000, { type: "percent", value: 150, minSubtotalCents: 0, active: true }),
      /100/,
    );
  });
});

describe("ticketTotals", () => {
  it("taxes only taxable lines, then scales tax after discount, then adds untaxed tip", () => {
    const discount = applyDiscount(249 * 2 + 199, { type: "percent", value: 10, minSubtotalCents: 0, active: true });
    const t = ticketTotals({
      lines: [cola, produce],
      taxRateBps: 825,
      discountCents: discount,
      tipCents: 100,
    });
    assert.equal(t.subtotal, 697);
    assert.equal(t.discountCents, 70);
    assert.equal(t.discounted, 627);
    assert.ok(t.taxCents > 0);
    assert.ok(t.taxCents < Math.round((498 * 825) / 10000));
    assert.equal(t.tipCents, 100);
    assert.equal(t.totalCents, t.discounted + t.taxCents + 100);
  });

  it("rejects empty-qty or negative price lines", () => {
    assert.throws(
      () =>
        ticketTotals({
          lines: [{ unitPriceCents: 100, quantity: 0, taxExempt: false }],
          taxRateBps: 0,
          discountCents: 0,
          tipCents: 0,
        }),
      /Invalid line/,
    );
  });
});

describe("tender", () => {
  it("requires payments to cover total including tip", () => {
    assert.equal(paymentCovers(1099, 1100), false);
    assert.equal(paymentCovers(1100, 1100), true);
    assert.equal(changeDue(1500, 1100), 400);
    assert.equal(changeDue(900, 1100), 0);
  });

  it("computes tip percents and gift-card split", () => {
    assert.equal(tipFromBps(1000, 1800), 180);
    assert.equal(giftApplied(2500, 800), 800);
    assert.equal(giftApplied(300, 800), 300);
  });
});

describe("receipt destinations", () => {
  it("validates email and phone", () => {
    assert.equal(isEmail("guest@store.test"), true);
    assert.equal(isEmail("nope"), false);
    assert.equal(isPhone("+1 (555) 555-0100"), true);
    assert.equal(isPhone("555"), false);
  });
});
