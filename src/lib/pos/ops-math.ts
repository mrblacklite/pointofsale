export function shiftExpected(openingCents: number, cashSalesCents: number) {
  return Math.max(0, openingCents) + Math.max(0, cashSalesCents);
}

export function shiftDifference(declaredCents: number, expectedCents: number) {
  return declaredCents - expectedCents;
}

export function barcodeUsable(barcode: string | null | undefined) {
  const v = barcode?.trim() ?? "";
  return v.length > 0;
}

export function discountWindowOpen(now: Date, startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;
  return true;
}

export function giftCardUsable(opts: {
  status: string;
  balanceCents: number;
  expiresAt: Date | null;
  now: Date;
}) {
  if (opts.status !== "active") return false;
  if (opts.balanceCents <= 0) return false;
  if (opts.expiresAt && opts.now > opts.expiresAt) return false;
  return true;
}

/** 1 loyalty point per whole dollar (100 cents) paid. */
export const LOYALTY_CENTS_PER_POINT_EARNED = 100;
/** 1 redeemed point = 1 cent off. 100 points = $1. */
export const LOYALTY_CENTS_PER_POINT_REDEEMED = 1;

export function loyaltyEarnPoints(paidCents: number) {
  if (!Number.isFinite(paidCents) || paidCents <= 0) return 0;
  return Math.floor(paidCents / LOYALTY_CENTS_PER_POINT_EARNED);
}

export function loyaltyRedeemCents(points: number) {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points) * LOYALTY_CENTS_PER_POINT_REDEEMED;
}

export function loyaltyApply(opts: {
  totalCents: number;
  availablePoints: number;
  redeemPoints: number;
}) {
  const total = Math.max(0, Math.floor(opts.totalCents));
  const available = Math.max(0, Math.floor(opts.availablePoints));
  const requested = Math.max(0, Math.floor(opts.redeemPoints));
  const redeemPoints = Math.min(requested, available, total);
  const redeemCents = loyaltyRedeemCents(redeemPoints);
  const dueCents = Math.max(0, total - redeemCents);
  return {
    redeemPoints,
    redeemCents,
    dueCents,
    earnedPoints: loyaltyEarnPoints(dueCents),
  };
}

export function cycleCountDelta(onHand: number, counted: number) {
  if (!Number.isFinite(onHand) || !Number.isFinite(counted)) return 0;
  return Math.trunc(counted) - Math.trunc(onHand);
}

export function stockFlag(quantity: number, reorderPoint: number): "out" | "low" | "ok" {
  if (quantity <= 0) return "out";
  if (quantity <= reorderPoint) return "low";
  return "ok";
}
