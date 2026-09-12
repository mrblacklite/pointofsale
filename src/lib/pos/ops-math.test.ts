import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  barcodeUsable,
  clockHours,
  discountWindowOpen,
  giftCardUsable,
  loyaltyApply,
  loyaltyEarnPoints,
  loyaltyRedeemCents,
  shiftDifference,
  shiftExpected,
} from "./ops-math.ts";

describe("shifts", () => {
  it("expected cash is opening plus cash sales; difference is declared minus expected", () => {
    assert.equal(shiftExpected(10000, 4550), 14550);
    assert.equal(shiftDifference(14500, 14550), -50);
    assert.equal(shiftDifference(14600, 14550), 50);
  });
});

describe("catalog rules", () => {
  it("treats blank barcodes as unused so uniqueness does not fire", () => {
    assert.equal(barcodeUsable(null), false);
    assert.equal(barcodeUsable("  "), false);
    assert.equal(barcodeUsable("012345678905"), true);
  });

  it("enforces discount windows", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    assert.equal(
      discountWindowOpen(now, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-30T00:00:00Z")),
      true,
    );
    assert.equal(discountWindowOpen(now, new Date("2026-10-01T00:00:00Z"), null), false);
    assert.equal(discountWindowOpen(now, null, new Date("2026-09-01T00:00:00Z")), false);
  });

  it("blocks expired or empty gift cards", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    assert.equal(giftCardUsable({ status: "active", balanceCents: 500, expiresAt: new Date("2026-12-01"), now }), true);
    assert.equal(giftCardUsable({ status: "disabled", balanceCents: 500, expiresAt: null, now }), false);
    assert.equal(giftCardUsable({ status: "active", balanceCents: 0, expiresAt: null, now }), false);
    assert.equal(giftCardUsable({ status: "active", balanceCents: 500, expiresAt: new Date("2026-01-01"), now }), false);
  });
});

describe("loyalty", () => {
  it("earns one point per dollar paid", () => {
    assert.equal(loyaltyEarnPoints(0), 0);
    assert.equal(loyaltyEarnPoints(99), 0);
    assert.equal(loyaltyEarnPoints(100), 1);
    assert.equal(loyaltyEarnPoints(1999), 19);
  });

  it("redeems one cent per point and caps at available points and ticket total", () => {
    assert.equal(loyaltyRedeemCents(100), 100);
    const applied = loyaltyApply({ totalCents: 1500, availablePoints: 400, redeemPoints: 999 });
    assert.equal(applied.redeemPoints, 400);
    assert.equal(applied.redeemCents, 400);
    assert.equal(applied.dueCents, 1100);
    assert.equal(applied.earnedPoints, 11);
  });
});

describe("time clock", () => {
  it("counts hours between in and out, or now if still open", () => {
    const inn = new Date("2026-09-12T09:00:00Z");
    const out = new Date("2026-09-12T17:30:00Z");
    const now = new Date("2026-09-12T10:00:00Z");
    assert.equal(clockHours(inn, out, now), 8.5);
    assert.equal(clockHours(inn, null, now), 1);
    assert.equal(clockHours(inn, new Date("2026-09-12T08:00:00Z"), now), 0);
  });
});
