# Till — Point of Sale

Web register with inventory, staff roles, discounts, gift cards, and a REST API so Windows / macOS / Linux programs can ring sales and move stock.

The first account to sign in (Google, X, or email) becomes the store admin. A grocery catalog, discounts (`WELCOME10`, `SAVE5`, `STAFF`), and gift cards (`TILL-2500`, `TILL-5000`) are seeded so you can ring a ticket immediately.

## Roles

| Role | Register | Catalog / stock | Voids | Staff & API keys |
| --- | --- | --- | --- | --- |
| Admin | yes | yes | yes | yes |
| Supervisor | yes | yes | yes | no |
| Cashier | yes | no | no | no |
| Stocker | no | yes | no | no |

Add staff by email. Optionally set a password so they can sign in immediately; otherwise they join when they create an account with that email.

## Sales API

Create a key on **API** in the app. Send it as a bearer token from any desktop client. CORS is open.

```
Authorization: Bearer till_…
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/products` | Catalog (`?q=` filters name, SKU, barcode) |
| GET | `/api/v1/products/{sku}` | One product by SKU or barcode |
| GET | `/api/v1/inventory` | On-hand quantities |
| POST | `/api/v1/inventory/adjust` | `{ "sku", "delta", "reason", "note" }` |
| GET | `/api/v1/gift-cards/{code}` | Balance lookup |
| POST | `/api/v1/sales` | Create a sale and decrement inventory |

`reason` for inventory adjust: `receive`, `adjust`, `waste`, or `count`.

Example sale (amounts are integer cents; payments must cover the computed total after tax and discount):

```bash
curl -X POST https://HOST/api/v1/sales \
  -H "Authorization: Bearer till_…" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{ "sku": "BEV-COLA", "quantity": 2 }],
    "discount_code": "WELCOME10",
    "payments": [
      { "method": "card", "amount_cents": 600 }
    ]
  }'
```

Gift-card tenders:

```json
{ "method": "gift_card", "amount_cents": 1500, "gift_card_code": "TILL-2500" }
```

Unknown SKUs and insufficient stock return HTTP 400 with `{ "error": "…" }`. Missing or revoked keys return 401.
