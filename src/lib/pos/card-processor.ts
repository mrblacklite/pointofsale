/**
 * Card capture for register tenders.
 * Uses Stripe PaymentIntents when STRIPE_SECRET_KEY is set.
 * Otherwise simulates a capture (dev / demo).
 */

export type CardChargeInput = {
  amountCents: number;
  currency: string;
  storeName: string;
  saleNote?: string | null;
  paymentMethodId?: string | null;
  cardToken?: string | null;
};

export type CardChargeResult = {
  processor: "stripe" | "simulated";
  processorRef: string;
  last4: string | null;
  status: "captured";
};

function env(name: string) {
  return (process.env[name] || "").trim();
}

export async function chargeCard(input: CardChargeInput): Promise<CardChargeResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw new Error("Card amount must be a positive integer in cents.");
  }
  const secret = env("STRIPE_SECRET_KEY");
  if (secret) return chargeStripe(secret, input);
  return simulateCharge(input);
}

async function chargeStripe(secret: string, input: CardChargeInput): Promise<CardChargeResult> {
  const body = new URLSearchParams();
  body.set("amount", String(input.amountCents));
  body.set("currency", input.currency.toLowerCase());
  body.set("confirm", "true");
  body.set("description", `${input.storeName} register`);
  if (input.saleNote) body.set("metadata[note]", input.saleNote);
  const pm = input.paymentMethodId?.trim();
  const token = input.cardToken?.trim();
  if (pm) body.set("payment_method", pm);
  else if (token) {
    body.set("payment_method_data[type]", "card");
    body.set("payment_method_data[card][token]", token);
  } else {
    throw new Error("Card payment needs payment_method_id or card_token when Stripe is configured.");
  }
  body.set("payment_method_types[]", "card");

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as {
    id?: string;
    status?: string;
    error?: { message?: string };
    charges?: { data?: Array<{ payment_method_details?: { card?: { last4?: string } } }> };
    last_payment_error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || json.last_payment_error?.message || "Stripe charge failed.");
  }
  if (json.status !== "succeeded" && json.status !== "requires_capture") {
    throw new Error(`Card not captured (${json.status ?? "unknown"}).`);
  }
  const last4 = json.charges?.data?.[0]?.payment_method_details?.card?.last4 ?? null;
  return {
    processor: "stripe",
    processorRef: json.id || "",
    last4,
    status: "captured",
  };
}

function simulateCharge(input: CardChargeInput): CardChargeResult {
  const token = (input.cardToken || input.paymentMethodId || "tok_sim_4242").trim();
  if (/fail|decline/i.test(token)) throw new Error("Card declined (simulated).");
  const last4 = /\d{4}$/.exec(token)?.[0] ?? "4242";
  return {
    processor: "simulated",
    processorRef: `sim_${Date.now().toString(36)}_${input.amountCents}`,
    last4,
    status: "captured",
  };
}
