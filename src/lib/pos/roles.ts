export const ROLES = ["admin", "supervisor", "cashier", "stocker", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  cashier: "Cashier",
  stocker: "Stocker",
  customer: "Customer",
};

export const ROLE_BLURB: Record<Role, string> = {
  admin: "Full access — staff, API keys, catalog, register, and voids.",
  supervisor: "Register, voids, discounts, gift cards, catalog, and reports.",
  cashier: "Ring sales, look up gift cards. Cannot edit catalog or staff.",
  stocker: "Products, receiving, and inventory counts. No register.",
  customer: "Account only. No register until an admin assigns a staff role.",
};

const PERMISSIONS = {
  pos: ["admin", "supervisor", "cashier"],
  void: ["admin", "supervisor"],
  catalog: ["admin", "supervisor", "stocker"],
  catalog_write: ["admin", "supervisor", "stocker"],
  inventory: ["admin", "supervisor", "stocker"],
  discounts: ["admin", "supervisor"],
  gift_cards: ["admin", "supervisor", "cashier"],
  gift_cards_issue: ["admin", "supervisor"],
  sales: ["admin", "supervisor", "cashier"],
  staff: ["admin"],
  api_keys: ["admin"],
  settings: ["admin"],
  reports: ["admin", "supervisor"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission) {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function assertCan(role: Role, permission: Permission) {
  if (!can(role, permission)) {
    throw new Error("You do not have permission to do that.");
  }
}
