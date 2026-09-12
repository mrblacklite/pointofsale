# Remaining POS features

This branch adds schema + server functions. Wire screens next.

## Included now
- Customers / loyalty points (`customers`)
- Held / parked tickets (`held_tickets` + `holdTicket` / `listHeldTickets` / `releaseHeldTicket`)
- Shifts / till expected vs declared (`shifts`, `openShift`, `closeShift`)
- Time clock table (`time_clock`)
- 30-day reports by day, SKU, cashier, tax (`salesReport`)
- Unique barcode per store
- Discount start/end + max redemptions columns
- Gift card `expires_at`
- `sales.customer_id`, `held`, `return_of_sale_id` for returns/exchanges

## Still to wire in UI / API
- `/reports`, `/customers`, `/shifts` routes + nav in `app-shell.tsx`
- Register: hold ticket, line discount, scanner HID buffer, age flag
- Partial returns (new sale with `return_of_sale_id`, restock)
- CSV import/export of products
- Purchase orders / suppliers / variants / images / modifiers / weighed items
- Employee PIN lock + cash-drawer kick
- API pagination, idempotency key, webhooks, tighter CORS
- Offline sale queue on the PWA
- Domain tests around sale/return/shift math

Permissions already have `reports`. Add `customers` / `shifts` if you want them off the cashier role.
