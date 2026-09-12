# Checkout wiring

This branch adds:

- `migrations/0003_checkout.sql` — `tip_cents`, customer contact, payment processor fields, `receipt_deliveries`
- `src/lib/pos/card-processor.ts` — Stripe PaymentIntent or simulated capture
- `src/lib/pos/receipts.ts` — Resend email / Twilio SMS (or simulated)
- `src/lib/pos/complete-sale.ts` — sale commit with tips + card capture + `sendSaleReceipt`
- Types on `CompleteSaleInput` / `SaleResult`

## Hook up the register

In `src/lib/pos/actions.ts` replace the local `completeSaleInternal` with:

```ts
export { completeSaleInternal, sendSaleReceipt } from "./complete-sale";
```

and extend `completeSaleSchema` with `tipCents`, `customerEmail`, `customerPhone`, `paymentMethodId`, `cardToken`.

In `src/lib/pos/api-handler.ts` import `completeSaleInternal` from `./complete-sale` and accept `tip_cents` / `POST /sales/{id}/receipt`.

In `src/routes/pos.tsx` import `sendSaleReceipt` from `@/lib/pos/complete-sale` and add tip buttons + email/SMS fields on the ticket dialog.

Env:

- `STRIPE_SECRET_KEY` — live card capture (otherwise simulated)
- `RESEND_API_KEY`, `RECEIPT_FROM_EMAIL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
