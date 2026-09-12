export type DiscountOffer = {
  type: "percent" | "fixed";
  value: number;
  minSubtotalCents: number;
  active: boolean;
};

export function applyDiscount(subtotal: number, offer: DiscountOffer | null | undefined) {
  if (!offer || !offer.active) return 0;
  if (subtotal < offer.minSubtotalCents) return 0;
  if (offer.type === "percent") {
    if (offer.value > 100) throw new Error("Percent cannot exceed 100.");
    return Math.min(subtotal, Math.round((subtotal * offer.value) / 100));
  }
  return Math.min(subtotal, Math.max(0, offer.value));
}

export function ticketTotals(opts: {
  lines: Array<{ unitPriceCents: number; quantity: number; taxExempt: boolean }>;
  taxRateBps: number;
  discountCents: number;
  tipCents: number;
}) {
  if (opts.lines.some((l) => l.quantity < 1 || l.unitPriceCents < 0)) {
    throw new Error("Invalid line.");
  }
  const subtotal = opts.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const rawTax = opts.lines.reduce(
    (s, l) => s + (l.taxExempt ? 0 : Math.round((l.unitPriceCents * l.quantity * opts.taxRateBps) / 10000)),
    0,
  );
  const discountCents = Math.min(Math.max(0, opts.discountCents), subtotal);
  const discounted = subtotal - discountCents;
  const taxScale = subtotal === 0 ? 0 : discounted / subtotal;
  const taxCents = Math.round(rawTax * taxScale);
  const tipCents = Math.max(0, opts.tipCents);
  return {
    subtotal,
    discountCents,
    discounted,
    taxCents,
    tipCents,
    totalCents: discounted + taxCents + tipCents,
  };
}

export function paymentCovers(paySum: number, totalCents: number) {
  return paySum >= totalCents;
}

export function changeDue(tenderedCents: number, totalCents: number) {
  return Math.max(0, tenderedCents - totalCents);
}

export function tipFromBps(pretipCents: number, bps: number) {
  return Math.round((Math.max(0, pretipCents) * Math.max(0, bps)) / 10000);
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

export function isPhone(value: string) {
  return normalizePhone(value).replace(/\D/g, "").length >= 10;
}

export function giftApplied(balanceCents: number, dueCents: number) {
  return Math.min(Math.max(0, balanceCents), Math.max(0, dueCents));
}
