# Till — Point of Sale

Till is a store register: ring sales, track inventory, manage staff, issue gift cards, and run the same counter from a Windows / macOS / Linux program through a bearer-token REST API.

The first person to sign in owns the store (admin). A grocery catalog, discounts, and sample gift cards are seeded so you can ring a ticket immediately.

## Roles

| Role | Register | Catalog / stock | Voids | Gift cards | Staff & API keys |
| --- | --- | --- | --- | --- | --- |
| Admin | yes | yes | yes | issue + redeem | yes |
| Supervisor | yes | yes | yes | issue + redeem | no |
| Cashier | yes | no | no | redeem | no |
| Stocker | no | yes | no | no | no |

Admins add staff by email. Optionally set a password so the account can sign in immediately; otherwise they join on first sign-up with that email.

## Database

Money is **integer cents**. IDs are text UUIDs. Every row is scoped to a `store_id`. One signed-in user belongs to one store.

| Table | Purpose |
| --- | --- |
| `stores` | Name, legal name, address, phone, tax rate (basis points, default 8.25%), currency, receipt footer. |
| `store_members` | Staff: email, display name, role (`admin` / `supervisor` / `cashier` / `stocker`), active flag. |
| `staff_invites` | Pending invites consumed on first sign-in matching the email. |
| `categories` | Product departments (Produce, Dairy, Bakery, …). |
| `products` | SKU, barcode, name, description, price/cost cents, tax exempt, track inventory, on-hand qty, reorder point, active. Unique SKU per store. |
| `inventory_movements` | Ledger of every quantity change: `receive`, `adjust`, `waste`, `count`, `sale`, `void`. |
| `discounts` | Codes: percent or fixed cents, optional minimum subtotal, active flag. |
| `gift_cards` | Code, initial and remaining balance, `active` / `disabled`. |
| `gift_card_ledger` | Issue, redeem, and void entries. |
| `sales` | Ticket header: receipt number, cashier, status (`completed` / `voided`), discount, subtotal, tax, total, tendered, change. |
| `sale_items` | Frozen line snapshots (SKU, name, qty, unit price, tax, line total). |
| `payments` | `cash`, `card`, or `gift_card` tenders on a ticket. |
| `api_keys` | Hashed `till_…` keys for desktop registers. Prefix stored for display; full token shown once. |
| `store_counters` | Next receipt number (starts at 1001). |

Sales decrement tracked inventory atomically. Voiding a ticket restores stock and gift-card balances.

## Sales API

Create a key on **API** in the app. Send it as a bearer token. CORS is open so native wrappers can call it.

```
Authorization: Bearer till_…
```

All money is integer cents. A sale’s payments must cover the computed total after tax and discount.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1` | Health, store tax rate, endpoint list |
| GET | `/api/v1/products` | Catalog (`?q=` filters name, SKU, barcode) |
| GET | `/api/v1/products/{sku}` | One product by SKU or barcode |
| POST | `/api/v1/products` | Create a product |
| PATCH | `/api/v1/products/{sku}` | Update price, qty, name, flags |
| GET | `/api/v1/categories` | Departments |
| GET | `/api/v1/inventory` | On-hand quantities |
| POST | `/api/v1/inventory/adjust` | `{ "sku", "delta", "reason", "note" }` |
| GET | `/api/v1/discounts` | Active and inactive codes |
| GET | `/api/v1/gift-cards/{code}` | Balance lookup |
| POST | `/api/v1/gift-cards` | `{ "amount_cents", "code"? }` |
| GET | `/api/v1/sales` | Recent tickets |
| GET | `/api/v1/sales/{id}` | Ticket by UUID or receipt number |
| POST | `/api/v1/sales/quote` | Price a cart without moving stock |
| POST | `/api/v1/sales` | Create a sale and decrement inventory |
| POST | `/api/v1/sales/{id}/void` | Void a ticket, restore stock |

Quote (no inventory change):

```json
{
  "items": [{ "sku": "BEV-COLA", "quantity": 2 }],
  "discount_code": "WELCOME10"
}
```

Commit a sale:

```json
{
  "items": [{ "sku": "BEV-COLA", "quantity": 2 }],
  "discount_code": "WELCOME10",
  "payments": [
    { "method": "card", "amount_cents": 600 }
  ]
}
```

Gift-card tenders use `"method": "gift_card"` plus `"gift_card_code"`. Split tenders (gift card + cash/card) are supported. Inventory reasons: `receive`, `adjust`, `waste`, `count`.

Python example:

```python
import requests

API = "https://YOUR-HOST/api/v1"
H = {"Authorization": "Bearer till_…", "Content-Type": "application/json"}

quote = requests.post(f"{API}/sales/quote", headers=H, json={
    "items": [{"sku": "BEV-COLA", "quantity": 2}],
}).json()["quote"]

requests.post(f"{API}/sales", headers=H, json={
    "items": [{"sku": "BEV-COLA", "quantity": 2}],
    "payments": [{"method": "card", "amount_cents": quote["total_cents"]}],
})
```

## Seeded catalog

First sign-in creates a market with Produce, Dairy, Bakery, Beverages, Snacks, Household, and Personal Care. Discount codes: `WELCOME10`, `SAVE5`, `STAFF`. Demo gift cards: `TILL-2500` ($25) and `TILL-5000` ($50). SKU `BEV-COLA` is the Cola 2L.

## Run locally

```bash
npm install
npm run dev
```

Sign in with Google, X, or email/password. Create a store on first sign-up.
