import type { Role } from "./roles";

export type Store = {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  taxRateBps: number;
  currency: string;
  receiptFooter: string | null;
};

export type Member = {
  id: string;
  storeId: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
};

export type SessionContext = {
  store: Store;
  member: Member;
  seeded: boolean;
};

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

export type Product = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  costCents: number;
  taxExempt: boolean;
  trackInventory: boolean;
  quantity: number;
  reorderPoint: number;
  active: boolean;
};

export type Discount = {
  id: string;
  code: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotalCents: number;
  active: boolean;
};

export type GiftCard = {
  id: string;
  code: string;
  initialCents: number;
  balanceCents: number;
  status: "active" | "disabled";
  createdAt: string;
};

export type SaleListItem = {
  id: string;
  receiptNumber: number;
  cashierName: string;
  status: "completed" | "voided";
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  itemCount: number;
};

export type SaleDetail = SaleListItem & {
  cashierUserId: string;
  note: string | null;
  discountCode: string | null;
  tenderedCents: number;
  changeCents: number;
  items: Array<{
    id: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    taxCents: number;
    lineTotalCents: number;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amountCents: number;
    giftCardCode: string | null;
  }>;
};

export type DayPoint = {
  day: string;
  cents: number;
  count: number;
};

export type DashboardData = {
  todayCents: number;
  todayCount: number;
  weekCents: number;
  avgTicketCents: number;
  inventoryValueCents: number;
  lowStock: Array<{
    id: string;
    name: string;
    sku: string;
    quantity: number;
    reorderPoint: number;
  }>;
  recentSales: SaleListItem[];
  weekSeries: DayPoint[];
};

export type CartLineInput = {
  productId: string;
  quantity: number;
};

export type CompleteSaleInput = {
  lines: CartLineInput[];
  discountCode?: string | null;
  payments: Array<{
    method: "cash" | "card" | "gift_card";
    amountCents: number;
    giftCardCode?: string | null;
    paymentMethodId?: string | null;
    cardToken?: string | null;
  }>;
  tenderedCents?: number;
  note?: string | null;
  tipCents?: number;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  redeemPoints?: number;
};

export type SaleResult = {
  id: string;
  receiptNumber: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  changeCents: number;
  tipCents: number;
  customerEmail: string | null;
  customerPhone: string | null;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    taxCents: number;
    lineTotalCents: number;
    track: boolean;
  }>;
  cashierName: string;
  storeName: string;
  receiptFooter: string | null;
  createdAt: string;
};

export type StaffRow = {
  id: string;
  userId: string | null;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  pending: boolean;
  createdAt: string;
};

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
};

export type Movement = {
  id: string;
  productName: string;
  sku: string;
  delta: number;
  reason: string;
  note: string | null;
  createdAt: string;
  userName: string;
};
