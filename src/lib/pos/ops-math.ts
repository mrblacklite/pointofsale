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
