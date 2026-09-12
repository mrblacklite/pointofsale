import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliverReceipt, renderReceiptText } from "./receipts.ts";

const payload = {
  storeName: "Corner Market",
  receiptNumber: 1001,
  totalCents: 1299,
  tipCents: 200,
  currency: "USD",
  footer: "Thanks",
  lines: [{ quantity: 2, name: "Cola 2L", lineTotalCents: 498 }],
};

describe("renderReceiptText", () => {
  it("includes store, ticket, lines, total, and tip", () => {
    const text = renderReceiptText(payload);
    assert.match(text, /Corner Market/);
    assert.match(text, /Ticket #1001/);
    assert.match(text, /2 × Cola 2L/);
    assert.match(text, /Tip/);
    assert.match(text, /Thanks/);
  });
});

describe("deliverReceipt validation", () => {
  it("rejects bad email and short phone", async () => {
    await assert.rejects(() => deliverReceipt({ channel: "email", destination: "nope", payload }), /Invalid email/);
    await assert.rejects(() => deliverReceipt({ channel: "sms", destination: "555", payload }), /Invalid phone/);
  });

  it("simulates email and sms when providers are unset", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    const email = await deliverReceipt({ channel: "email", destination: "guest@store.test", payload });
    assert.equal(email.status, "simulated");
    assert.equal(email.provider, "simulated");
    const sms = await deliverReceipt({ channel: "sms", destination: "+15555550100", payload });
    assert.equal(sms.status, "simulated");
  });
});
