import { z } from 'zod';

/* ───────────── Rôles & permissions (RBAC) ───────────── */

export const ROLES = ['manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);
export const ROLE_LABELS: Record<Role, string> = { manager: 'Gérant', cashier: 'Caissier' };

export type Permission =
  | 'pos' // voir le menu/les tables, prendre commande
  | 'orders:read'
  | 'orders:write'
  | 'orders:pay'
  | 'orders:void'
  | 'settings:read'
  | 'admin'; // tout le reste (dashboard, catalogue, stock, achats, dépenses, utilisateurs…)

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  manager: ['pos', 'orders:read', 'orders:write', 'orders:pay', 'orders:void', 'settings:read', 'admin'],
  // Le caissier ne voit QUE : prise de commande par table, encaissement/ticket.
  cashier: ['pos', 'orders:read', 'orders:write', 'orders:pay', 'settings:read'],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

/* ───────────── Constantes métier ───────────── */

export const PAYMENT_METHODS = ['cash', 'mvola', 'orange_money', 'airtel_money', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  mvola: 'MVola',
  orange_money: 'Orange Money',
  airtel_money: 'Airtel Money',
  card: 'Carte',
};

export const EXPENSE_CATEGORIES = ['Charge fixe', 'Cuisson', 'Personnel', 'Entretien', 'Autre'] as const;
export const STOCK_KINDS = ['ingredient', 'product'] as const;
export const STOCK_KIND_LABELS = { ingredient: 'Ingrédient', product: 'Produit revendu' } as const;
export const MENU_KINDS = ['cooked', 'resale'] as const;
export const MENU_KIND_LABELS = { cooked: 'Cuisiné (recette)', resale: 'Revendu tel quel' } as const;
export const PAPER_WIDTHS = [32, 42, 48] as const; // colonnes : 58 mm = 32, 80 mm = 42 ou 48

/* ───────────── Schémas de validation (API + formulaires) ───────────── */

export const idSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const money = (label = 'Montant') =>
  z.number({ message: `${label} requis` }).int('Nombre entier requis').min(0, 'Doit être positif');
const text = (label: string, max = 120) =>
  z.string({ message: `${label} requis` }).trim().min(1, `${label} requis`).max(max);
const optionalText = (max = 200) => z.string().trim().max(max).nullish();

export const pinSchema = z.string().regex(/^\d{4,6}$/, 'Le PIN doit contenir 4 à 6 chiffres');
export const passwordSchema = z.string().min(8, '8 caractères minimum').max(128);

export const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
export const pinLoginSchema = z.object({ username: z.string().trim().min(1), pin: pinSchema });
export const changePasswordSchema = z.object({ current_password: z.string().min(1), new_password: passwordSchema });

export const userBase = z.object({
  username: z
    .string()
    .trim()
    .min(3, '3 caractères minimum')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Lettres, chiffres, . _ - uniquement'),
  full_name: text('Nom complet'),
  role: roleSchema,
  password: passwordSchema.nullish().or(z.literal('')),
  pin: pinSchema.nullish().or(z.literal('')),
  is_active: z.boolean().optional(),
});
export const userCreateSchema = userBase.refine((u) => (u.role === 'manager' ? !!u.password : !!u.password || !!u.pin), {
  message: 'Mot de passe requis (gérant) ou PIN / mot de passe (caissier)',
  path: ['password'],
});
export const userUpdateSchema = userBase.partial();

export const categorySchema = z.object({ name: text('Nom', 60), sort_order: z.number().int().optional() });

export const stockItemSchema = z.object({
  name: text('Nom'),
  kind: z.enum(STOCK_KINDS),
  unit: text('Unité de stock', 20),
  min_qty: z.number({ message: 'Seuil requis' }).min(0),
  purchase_unit: text("Unité d'achat", 20),
  purchase_factor: z.number({ message: 'Facteur requis' }).positive('Doit être > 0'),
  is_active: z.boolean().optional(),
});

const menuItemBase = z.object({
  name: text('Nom'),
  category_id: idSchema,
  kind: z.enum(MENU_KINDS),
  price: money('Prix'),
  stock_item_id: idSchema.nullish(),
  is_active: z.boolean().optional(),
});
export const menuItemSchema = menuItemBase.refine((m) => m.kind !== 'resale' || !!m.stock_item_id, {
  message: 'Produit en stock requis pour un article revendu',
  path: ['stock_item_id'],
});
export const menuItemUpdateSchema = menuItemBase.partial();

export const recipeSchema = z.object({
  lines: z
    .array(z.object({ stock_item_id: idSchema, qty_per_portion: z.number().positive('Doit être > 0') }))
    .max(60),
});

export const supplierSchema = z.object({ name: text('Nom'), phone: optionalText(40) });

export const purchaseSchema = z.object({
  date: dateSchema,
  stock_item_id: idSchema,
  quantity: z.number({ message: 'Quantité requise' }).positive('Doit être > 0'),
  unit_price: money('Prix unitaire'),
  supplier_id: idSchema.nullish(),
  note: optionalText(),
});

export const expenseSchema = z.object({
  date: dateSchema,
  label: text('Libellé'),
  category: z.string().trim().min(1).max(40),
  amount: money('Montant'),
});

export const tableSchema = z.object({
  name: text('Nom', 30),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export const orderPutSchema = z.object({
  table_id: idSchema,
  note: optionalText(300),
  lines: z
    .array(
      z.object({
        menu_item_id: idSchema,
        quantity: z.number().int().min(1).max(99),
        note: optionalText(120),
      }),
    )
    .min(1, 'La commande est vide')
    .max(100),
});

export const payOrderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount_received: z.number().int().min(0).nullish(),
});
export const voidOrderSchema = z.object({ reason: text('Motif', 200) });

export const stockAdjustSchema = z.object({
  stock_item_id: idSchema,
  counted: z.number({ message: 'Quantité comptée requise' }).min(0),
  note: optionalText(),
});

export const settingsSchema = z.object({
  restaurant_name: text('Nom du restaurant', 80),
  address: z.string().trim().max(160).default(''),
  phone: z.string().trim().max(40).default(''),
  ticket_footer: z.string().trim().max(160).default('Merci de votre visite !'),
  paper_width: z.union([z.literal(32), z.literal(42), z.literal(48)]).default(42),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  restaurant_name: 'Mon Restaurant',
  address: '',
  phone: '',
  ticket_footer: 'Merci de votre visite !',
  paper_width: 42,
};

export const openingBalanceSchema = z.object({ date: dateSchema, amount: money('Solde') });

/* ───────────── DTO (réponses de l'API) ───────────── */

export interface UserDto {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  has_pin?: boolean;
}
export interface AuthResponse {
  token: string;
  user: UserDto;
}
export interface OrderLineDto {
  id: string;
  menu_item_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  note: string | null;
}
export interface OrderDto {
  id: string;
  ticket_no: number;
  table_id: string;
  table_name: string;
  status: 'open' | 'paid' | 'cancelled';
  note: string | null;
  total: number;
  payment_method: PaymentMethod | null;
  amount_received: number | null;
  business_date: string | null;
  created_at: string;
  paid_at: string | null;
  opened_by_name: string | null;
  paid_by_name: string | null;
  void_reason: string | null;
  lines: OrderLineDto[];
}
export interface PosTableDto {
  id: string;
  name: string;
  open_order_id: string | null;
  open_total: number | null;
  open_since: string | null;
}
export interface PosMenuDto {
  categories: { id: string; name: string }[];
  items: { id: string; name: string; price: number; category_id: string; kind: 'cooked' | 'resale' }[];
}
export interface StockRowDto {
  id: string;
  name: string;
  kind: 'ingredient' | 'product';
  unit: string;
  min_qty: number;
  qty: number;
  low: boolean;
}
export interface DashboardDto {
  date: string;
  kpis: {
    sales_day: number;
    sales_month: number;
    orders_day: number;
    orders_month: number;
    purchases_day: number;
    purchases_month: number;
    expenses_day: number;
    expenses_month: number;
    profit_day: number;
    profit_month: number;
  };
  cash: { opening: number; inflow: number; outflow: number; remaining: number };
  series: { date: string; total: number }[];
  top_items: { name: string; quantity: number; revenue: number }[];
  by_method: { method: PaymentMethod; total: number; count: number }[];
  low_stock: { id: string; name: string; unit: string; qty: number; min_qty: number }[];
  open_orders: number;
}
export interface YearlyRowDto {
  month: number;
  sales: number;
  purchases: number;
  expenses: number;
  profit: number;
}

/* ───────────── Évènements temps réel (WebSocket) ───────────── */
export type RealtimeEvent =
  | { type: 'order.changed'; order_id: string; table_id: string; status: 'open' | 'paid' | 'cancelled' }
  | { type: 'stock.changed' };

/* ───────────── Utilitaires ───────────── */
export function formatAr(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString('fr-FR').replace(/ | /g, ' ')} Ar`;
}
export function todayInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
