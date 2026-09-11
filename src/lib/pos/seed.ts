import { newId } from "@/lib/utils";
import type { Sql } from "@/lib/db";

type SeedProduct = {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  qty: number;
  reorder: number;
  category: string;
  taxExempt?: boolean;
};

const CATEGORIES = [
  "Produce",
  "Dairy",
  "Bakery",
  "Beverages",
  "Snacks",
  "Household",
  "Personal Care",
];

const PRODUCTS: SeedProduct[] = [
  { sku: "PRD-APL", barcode: "4011", name: "Honeycrisp Apple", description: "Sold each", price: 129, cost: 55, qty: 48, reorder: 12, category: "Produce" },
  { sku: "PRD-BAN", barcode: "40112", name: "Banana", description: "Sold each", price: 69, cost: 22, qty: 60, reorder: 16, category: "Produce" },
  { sku: "PRD-AVO", barcode: "4225", name: "Hass Avocado", description: "Ripe, sold each", price: 199, cost: 90, qty: 18, reorder: 8, category: "Produce" },
  { sku: "PRD-TOM", barcode: "4088", name: "Vine Tomato", description: "Sold each", price: 89, cost: 30, qty: 4, reorder: 10, category: "Produce" },
  { sku: "DRY-MLK", barcode: "028000111111", name: "Whole Milk ½ gal", description: "Local dairy", price: 449, cost: 240, qty: 22, reorder: 8, category: "Dairy" },
  { sku: "DRY-EGG", barcode: "028000222222", name: "Large Eggs, dozen", description: "Grade A", price: 429, cost: 210, qty: 16, reorder: 6, category: "Dairy" },
  { sku: "DRY-YOG", barcode: "028000333333", name: "Greek Yogurt", description: "Plain, 32 oz", price: 189, cost: 80, qty: 24, reorder: 8, category: "Dairy" },
  { sku: "DRY-BUT", barcode: "028000444444", name: "Cultured Butter", description: "8 oz", price: 549, cost: 280, qty: 12, reorder: 4, category: "Dairy" },
  { sku: "BRD-SDR", barcode: "078000111111", name: "Sourdough Loaf", description: "Baked this morning", price: 599, cost: 180, qty: 8, reorder: 4, category: "Bakery" },
  { sku: "BRD-CRS", barcode: "078000222222", name: "Butter Croissant", description: "Sold each", price: 249, cost: 70, qty: 14, reorder: 6, category: "Bakery" },
  { sku: "BEV-SPK", barcode: "049000111111", name: "Sparkling Water", description: "12 oz can", price: 179, cost: 55, qty: 36, reorder: 12, category: "Beverages" },
  { sku: "BEV-CB", barcode: "049000222222", name: "Cold Brew", description: "16 oz bottle", price: 429, cost: 140, qty: 10, reorder: 6, category: "Beverages" },
  { sku: "BEV-COLA", barcode: "049000333333", name: "Cola 2L", description: "Classic", price: 299, cost: 110, qty: 20, reorder: 8, category: "Beverages" },
  { sku: "BEV-OJ", barcode: "049000444444", name: "Orange Juice", description: "52 oz", price: 499, cost: 220, qty: 3, reorder: 6, category: "Beverages" },
  { sku: "SNK-CHIP", barcode: "028100111111", name: "Kettle Chips", description: "Sea salt, 5 oz", price: 349, cost: 120, qty: 28, reorder: 10, category: "Snacks" },
  { sku: "SNK-CHOC", barcode: "028100222222", name: "Dark Chocolate", description: "70% bar", price: 299, cost: 110, qty: 18, reorder: 6, category: "Snacks" },
  { sku: "SNK-TRL", barcode: "028100333333", name: "Trail Mix", description: "12 oz", price: 549, cost: 210, qty: 11, reorder: 5, category: "Snacks" },
  { sku: "HSE-SOAP", barcode: "037000111111", name: "Dish Soap", description: "18 oz", price: 399, cost: 140, qty: 14, reorder: 5, category: "Household" },
  { sku: "HSE-PT", barcode: "037000222222", name: "Paper Towels", description: "2-pack", price: 649, cost: 280, qty: 9, reorder: 4, category: "Household" },
  { sku: "HSE-DET", barcode: "037000333333", name: "Laundry Detergent", description: "50 oz", price: 1199, cost: 520, qty: 2, reorder: 4, category: "Household" },
  { sku: "PC-HS", barcode: "041000111111", name: "Hand Soap", description: "12 oz pump", price: 449, cost: 150, qty: 13, reorder: 5, category: "Personal Care" },
  { sku: "PC-TP", barcode: "041000222222", name: "Toothpaste", description: "Mint, 4 oz", price: 379, cost: 130, qty: 16, reorder: 6, category: "Personal Care" },
];

export async function seedStore(sql: Sql, storeId: string, userId: string) {
  const catIds = new Map<string, string>();
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const id = newId();
    catIds.set(CATEGORIES[i], id);
    await sql`
      insert into categories (id, store_id, name, sort_order)
      values (${id}, ${storeId}, ${CATEGORIES[i]}, ${i})
    `;
  }

  for (const p of PRODUCTS) {
    const id = newId();
    const cat = catIds.get(p.category) ?? null;
    await sql`
      insert into products (
        id, store_id, category_id, sku, barcode, name, description,
        price_cents, cost_cents, tax_exempt, track_inventory, quantity, reorder_point
      ) values (
        ${id}, ${storeId}, ${cat}, ${p.sku}, ${p.barcode}, ${p.name}, ${p.description},
        ${p.price}, ${p.cost}, ${p.taxExempt ?? false}, true, ${p.qty}, ${p.reorder}
      )
    `;
    await sql`
      insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
      values (${newId()}, ${storeId}, ${id}, ${p.qty}, 'receive', 'Opening stock', ${userId})
    `;
  }

  await sql`
    insert into discounts (id, store_id, code, name, type, value, min_subtotal_cents, active)
    values
      (${newId()}, ${storeId}, 'WELCOME10', 'Welcome 10%', 'percent', 10, 1000, true),
      (${newId()}, ${storeId}, 'SAVE5', '$5 off $25', 'fixed', 500, 2500, true),
      (${newId()}, ${storeId}, 'STAFF', 'Staff 15%', 'percent', 15, 0, true)
  `;

  await sql`
    insert into gift_cards (id, store_id, code, initial_cents, balance_cents, status)
    values
      (${newId()}, ${storeId}, 'TILL-2500', 2500, 2500, 'active'),
      (${newId()}, ${storeId}, 'TILL-5000', 5000, 5000, 'active')
  `;
}
