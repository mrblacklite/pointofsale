import { newId } from "@/lib/utils";

export type ReceiptChannel = "email" | "sms";

export type ReceiptPayload = {
  storeName: string;
  receiptNumber: number;
  totalCents: number;
  tipCents: number;
  currency: string;
  footer: string | null;
  lines: Array<{ quantity: number; name: string; lineTotalCents: number }>;
};

function env(name: string) {
  return (process.env[name] || "").trim();
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function renderReceiptText(p: ReceiptPayload) {
  const rows = p.lines.map((l) => `${l.quantity} × ${l.name}  ${money(l.lineTotalCents, p.currency)}`);
  const tip = p.tipCents > 0 ? `\nTip  ${money(p.tipCents, p.currency)}` : "";
  return [
    p.storeName,
    `Ticket #${p.receiptNumber}`,
    ...rows,
    `Total  ${money(p.totalCents, p.currency)}${tip}`,
    p.footer ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function deliverReceipt(opts: {
  channel: ReceiptChannel;
  destination: string;
  payload: ReceiptPayload;
}): Promise<{ status: "sent" | "simulated" | "failed"; provider: string; providerRef: string | null; error: string | null }> {
  const dest = opts.destination.trim();
  if (opts.channel === "email") {
    if (!/[^\s@]+@[^\s@]+\.[^\s@]+/.test(dest)) throw new Error("Invalid email address.");
    return sendEmail(dest, opts.payload);
  }
  const phone = dest.replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 10) throw new Error("Invalid phone number.");
  return sendSms(phone, opts.payload);
}

async function sendEmail(to: string, payload: ReceiptPayload) {
  const key = env("RESEND_API_KEY");
  const from = env("RECEIPT_FROM_EMAIL") || "Till <receipts@localhost>";
  const text = renderReceiptText(payload);
  if (!key) {
    console.info("[receipts] simulate email", to);
    return { status: "simulated" as const, provider: "simulated", providerRef: newId(), error: null };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${payload.storeName} receipt #${payload.receiptNumber}`,
      text,
    }),
  });
  const json = (await res.json()) as { id?: string; message?: string };
  if (!res.ok) {
    return { status: "failed" as const, provider: "resend", providerRef: null, error: json.message || "email failed" };
  }
  return { status: "sent" as const, provider: "resend", providerRef: json.id ?? null, error: null };
}

async function sendSms(to: string, payload: ReceiptPayload) {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");
  const text = renderReceiptText(payload).slice(0, 320);
  if (!sid || !token || !from) {
    console.info("[receipts] simulate sms", to);
    return { status: "simulated" as const, provider: "simulated", providerRef: newId(), error: null };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({ To: to, From: from, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) {
    return { status: "failed" as const, provider: "twilio", providerRef: null, error: json.message || "sms failed" };
  }
  return { status: "sent" as const, provider: "twilio", providerRef: json.sid ?? null, error: null };
}
