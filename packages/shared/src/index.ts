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
  /** Quantité de stock retirée par vente d'un article revendu (ex. 1500 ml pour une bouteille de 1,5 L). */
  stock_qty: z.number({ message: 'Quantité requise' }).positive('Doit être > 0').max(1_000_000).optional(),
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
  /** Prix d'achat actuel d'une unité d'achat (ex. 1 bouteille, 1 kg) : facultatif, mémorisé pour la rentabilité. */
  unit_cost: z.number().int('Nombre entier').min(0).nullish(),
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
  purchase_unit: string;
  purchase_factor: number;
  /** Prix d'achat par unité d'achat (moyenne pondérée des achats, sinon prix saisi à l'inventaire). */
  purchase_cost: number | null;
  /** Prix d'achat par unité de stock. */
  unit_cost: number | null;
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
  series: { date: string; total: number }[];
  top_items: { name: string; quantity: number; revenue: number }[];
  by_method: { method: PaymentMethod; total: number; count: number }[];
  low_stock: { id: string; name: string; unit: string; qty: number; min_qty: number }[];
  open_orders: number;
}
export interface YearlyRowDto {
  month: number;
  sales: number;
  orders: number;
  purchases: number;
  expenses: number;
  profit: number;
}

/* ───────────── Utilitaires ───────────── */
export function formatAr(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString('fr-FR').replace(/ | /g, ' ')} Ar`;
}
export function todayInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/* ═════════════════════════ MODULE HÔTEL ═════════════════════════ */

export const HOTEL_RES_STATUSES = ['option', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] as const;
export type HotelResStatus = (typeof HOTEL_RES_STATUSES)[number];
export const HOTEL_STATUS_LABELS: Record<HotelResStatus, string> = {
  option: 'En option',
  confirmed: 'Confirmée',
  checked_in: 'En cours',
  checked_out: 'Terminée',
  cancelled: 'Annulée',
};
/** Statuts qui bloquent la chambre sur les dates de séjour. */
export const HOTEL_ACTIVE_STATUSES: readonly HotelResStatus[] = ['option', 'confirmed', 'checked_in'];

export const HOTEL_PAYMENT_METHODS = ['cash', 'mvola', 'orange_money', 'airtel_money', 'cheque', 'transfer', 'other'] as const;
export type HotelPaymentMethod = (typeof HOTEL_PAYMENT_METHODS)[number];
export const HOTEL_PAYMENT_LABELS: Record<HotelPaymentMethod, string> = {
  cash: 'Espèces',
  mvola: 'MVola',
  orange_money: 'Orange Money',
  airtel_money: 'Airtel Money',
  cheque: 'Chèque',
  transfer: 'Virement',
  other: 'Autre',
};
export const HOTEL_PAYMENT_KINDS = ['deposit', 'payment', 'refund'] as const;
export const HOTEL_PAYMENT_KIND_LABELS = { deposit: 'Acompte', payment: 'Paiement', refund: 'Remboursement' } as const;

export const ROOM_TECH_STATUSES = ['normal', 'cleaning', 'maintenance', 'out_of_service'] as const;
export type RoomTechStatus = (typeof ROOM_TECH_STATUSES)[number];
export const ROOM_TECH_LABELS: Record<RoomTechStatus, string> = {
  normal: 'Normal',
  cleaning: 'À nettoyer',
  maintenance: 'En maintenance',
  out_of_service: 'Hors service',
};
export type RoomLiveStatus = 'available' | 'reserved' | 'arriving' | 'occupied' | 'cleaning' | 'maintenance' | 'out_of_service';
export const ROOM_LIVE_LABELS: Record<RoomLiveStatus, string> = {
  available: 'Disponible',
  reserved: 'Réservée',
  arriving: 'Arrivée aujourd’hui',
  occupied: 'Occupée',
  cleaning: 'À nettoyer',
  maintenance: 'En maintenance',
  out_of_service: 'Hors service',
};
export const CHARGE_MODES = ['flat', 'per_night'] as const;
export const CHARGE_MODE_LABELS = { flat: 'Forfait (une fois)', per_night: 'Par nuit' } as const;
export const RATE_MODES = ['fixed', 'percent'] as const;
export const RATE_MODE_LABELS = { fixed: 'Prix fixe par nuit (Ar)', percent: 'Variation en % du tarif' } as const;
export const WEEKDAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (#RRGGBB)');

export const roomTypeSchema = z.object({
  name: text('Nom'),
  color: color.default('#3b82f6'),
  base_price: money('Prix'),
  capacity: z.number().int().min(1).max(50),
  sort_order: z.number().int().default(0),
});
export const roomSchema = z.object({
  number: text('Numéro / nom', 40),
  room_type_id: idSchema,
  capacity: z.number().int().min(1).max(50).nullish(),
  price: money('Prix').nullish(),
  tech_status: z.enum(ROOM_TECH_STATUSES).default('normal'),
  is_active: z.boolean().default(true),
  notes: optionalText(300),
  sort_order: z.number().int().default(0),
});
export const hotelServiceSchema = z.object({
  name: text('Nom', 80),
  unit_price: money('Prix'),
  charge_mode: z.enum(CHARGE_MODES).default('flat'),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});
const rateRuleBase = z.object({
    name: text('Nom', 80),
    room_type_id: idSchema.nullish(),
    date_from: dateSchema,
    date_to: dateSchema,
    mode: z.enum(RATE_MODES),
    value: z.number({ message: 'Valeur requise' }).int('Nombre entier').min(-100, 'Min -100').max(100_000_000),
    weekdays: z.array(z.number().int().min(0).max(6)).nullish(),
    priority: z.number().int().default(0),
    is_active: z.boolean().default(true),
  });
export const rateRulePatchSchema = rateRuleBase.partial();
export const rateRuleSchema = rateRuleBase
  .refine((v) => v.date_to >= v.date_from, { path: ['date_to'], message: 'La fin doit suivre le début' })
  .refine((v) => v.mode !== 'fixed' || v.value >= 0, { path: ['value'], message: 'Prix positif requis' });
export const hotelClientSchema = z.object({
  full_name: text('Nom du client', 120),
  phone: optionalText(40),
  email: z.string().trim().email('E-mail invalide').max(120).nullish().or(z.literal('')),
  id_document: optionalText(60),
  address: optionalText(200),
  notes: optionalText(300),
});

const extraLineSchema = z.object({
  service_id: idSchema.nullish(),
  label: text('Libellé', 100),
  unit_price: money('Prix'),
  quantity: z.number().int().min(1).max(999),
  multiplier: z.number().int().min(1).max(999).default(1),
});
const depositSchema = z.object({
  amount: money('Acompte'),
  method: z.enum(HOTEL_PAYMENT_METHODS),
  paid_on: dateSchema.optional(),
});
const reservationBase = z.object({
  client_id: idSchema.optional(),
  new_client: hotelClientSchema.optional(),
  arrival: dateSchema,
  departure: dateSchema,
  adults: z.number().int().min(1).max(100).default(1),
  children: z.number().int().min(0).max(100).default(0),
  price_per_night: money('Prix par nuit'),
  discount_percent: z.number().min(0).max(100).default(0),
  discount_amount: money('Remise').default(0),
  status: z.enum(['option', 'confirmed']).default('confirmed'),
  note: optionalText(500),
  extras: z.array(extraLineSchema).max(30).default([]),
});
const dateOrder = (v: { arrival: string; departure: string }) => v.departure > v.arrival;
export const reservationCreateSchema = reservationBase
  .extend({ room_id: idSchema, deposit: depositSchema.optional() })
  .refine((v) => !!v.client_id || !!v.new_client, { path: ['client_id'], message: 'Choisissez ou créez un client' })
  .refine(dateOrder, { path: ['departure'], message: 'Le départ doit être après l’arrivée' });
export const reservationGroupSchema = reservationBase
  .omit({ price_per_night: true })
  .extend({
    rooms: z.array(z.object({ room_id: idSchema, price_per_night: money('Prix par nuit') })).min(1, 'Choisissez au moins une chambre').max(30),
    deposit: depositSchema.optional(),
  })
  .refine((v) => !!v.client_id || !!v.new_client, { path: ['client_id'], message: 'Choisissez ou créez un client' })
  .refine(dateOrder, { path: ['departure'], message: 'Le départ doit être après l’arrivée' });
export const reservationUpdateSchema = reservationBase
  .omit({ new_client: true, status: true })
  .extend({ room_id: idSchema })
  .partial()
  .refine((v) => !v.arrival || !v.departure || v.departure > v.arrival, { path: ['departure'], message: 'Le départ doit être après l’arrivée' });
export const reservationStatusSchema = z.object({
  status: z.enum(HOTEL_RES_STATUSES),
  reason: optionalText(200),
});
export const hotelPaymentSchema = z.object({
  amount: z.number({ message: 'Montant requis' }).int('Nombre entier').refine((n) => n !== 0, 'Montant non nul'),
  method: z.enum(HOTEL_PAYMENT_METHODS),
  kind: z.enum(HOTEL_PAYMENT_KINDS).default('payment'),
  paid_on: dateSchema.optional(),
  note: optionalText(200),
});
export const hotelSettingsSchema = z.object({
  name: z.string().trim().max(120).default('Mon Hôtel'),
  address: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(60).default(''),
  email: z.string().trim().max(120).default(''),
  tax_id: z.string().trim().max(80).default(''),
  ref_prefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Lettres, chiffres et tirets').default('HM-01'),
  checkin_time: z.string().regex(/^\d{2}:\d{2}$/).default('14:00'),
  checkout_time: z.string().regex(/^\d{2}:\d{2}$/).default('12:00'),
  tourist_tax_per_person_night: money('Taxe').default(0),
  vat_percent: z.number().min(0).max(100).default(0),
  invoice_footer: z.string().trim().max(300).default('Merci de votre séjour !'),
});
export type HotelSettings = z.infer<typeof hotelSettingsSchema>;
export const DEFAULT_HOTEL_SETTINGS: HotelSettings = hotelSettingsSchema.parse({});

export interface HotelExtraDto {
  id: string;
  service_id: string | null;
  label: string;
  unit_price: number;
  quantity: number;
  multiplier: number;
  amount: number;
}
export interface HotelPaymentDto {
  id: string;
  amount: number;
  method: HotelPaymentMethod;
  kind: 'deposit' | 'payment' | 'refund';
  paid_on: string;
  note: string | null;
  created_at: string;
}
export type HotelPayStatus = 'unpaid' | 'partial' | 'paid';
export interface HotelReservationDto {
  id: string;
  ref: string;
  group_id: string | null;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  room_id: string;
  room_number: string;
  room_type_name: string;
  room_color: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  price_per_night: number;
  lodging_amount: number;
  extras: HotelExtraDto[];
  extras_amount: number;
  tourist_tax: number;
  total_amount: number;
  discount_percent: number;
  discount_amount: number;
  net_amount: number;
  payments: HotelPaymentDto[];
  paid_amount: number;
  balance: number;
  pay_status: HotelPayStatus;
  status: HotelResStatus;
  note: string | null;
  cancel_reason: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  is_demo: boolean;
  created_at: string;
}
export interface HotelRoomDto {
  id: string;
  number: string;
  room_type_id: string;
  type_name: string;
  color: string;
  capacity: number;
  effective_price: number;
  tech_status: RoomTechStatus;
  is_active: boolean;
  notes: string | null;
  sort_order: number;
  occupied_by: string | null;
  occupied_reservation_id: string | null;
  occupied_until: string | null;
  arriving_today: boolean;
  next_arrival: string | null;
  next_client: string | null;
}
export interface HotelQuoteDto {
  nights: number;
  nightly: { date: string; price: number; rule: string | null }[];
  total: number;
  average: number;
  base_price: number;
}
export interface HotelDashboardDto {
  date: string;
  units_total: number;
  occupied_today: number;
  occupancy_percent: number;
  arrivals_today: number;
  departures_today: number;
  upcoming_7d: number;
  revenue_month: number;
  collected_month: number;
  collected_total: number;
  outstanding_total: number;
  status_counts: Record<HotelResStatus, number>;
  room_status: Record<RoomLiveStatus, number>;
  monthly: { month: string; reservations: number; nights: number; revenue: number; collected: number }[];
  weekly: { week_start: string; reservations: number; nights: number; revenue: number }[];
  by_method: { method: HotelPaymentMethod; total: number }[];
}

/** Statut en temps réel d'une chambre (calculé, jamais stocké). */
export function roomLiveStatus(r: Pick<HotelRoomDto, 'tech_status' | 'occupied_by' | 'occupied_reservation_id' | 'arriving_today' | 'next_arrival'>): RoomLiveStatus {
  if (r.tech_status === 'maintenance' || r.tech_status === 'out_of_service') return r.tech_status;
  if (r.occupied_reservation_id) return 'occupied';
  if (r.tech_status === 'cleaning') return 'cleaning';
  if (r.arriving_today) return 'arriving';
  if (r.next_arrival) return 'reserved';
  return 'available';
}

/* ───────────── Rentabilité des menus ───────────── */
export type CostBasis = 'average' | 'last';
export interface ProfitCostLine {
  stock_item_id: string;
  name: string;
  unit: string;
  qty: number; // quantité par portion (unité de stock)
  unit_cost: number | null; // Ar par unité de stock ; null = aucun achat enregistré
  cost: number | null;
}
export interface ProfitabilityRowDto {
  id: string;
  name: string;
  category_name: string;
  kind: 'cooked' | 'resale';
  price: number;
  cost: number; // coût matières par portion (ingrédients sans achat = 0, voir missing_cost)
  margin: number; // prix − coût
  margin_percent: number; // marge / prix
  cost_percent: number; // coût / prix
  missing_cost: boolean;
  lines: ProfitCostLine[];
  sold_qty: number;
  revenue: number;
  cost_total: number;
  profit_total: number;
}
export interface ProfitabilityDto {
  from: string;
  to: string;
  basis: CostBasis;
  rows: ProfitabilityRowDto[];
  totals: { revenue: number; cost_total: number; profit_total: number; margin_percent: number };
}

/* ───────────── Saisie de ventes antérieures ───────────── */
export const backdatedSaleSchema = z.object({
  date: dateSchema,
  payment_method: z.enum(PAYMENT_METHODS),
  lines: z.array(z.object({ menu_item_id: idSchema, quantity: z.number().int().min(1).max(999) })).min(1, 'Ajoutez au moins un plat').max(60),
  update_stock: z.boolean().default(true),
  note: z.string().trim().max(200).nullish(),
});
export type BackdatedSale = z.infer<typeof backdatedSaleSchema>;

/** Rapport de ventes d'une période (statistiques + export PDF). */
export interface SalesReportDto {
  from: string;
  to: string;
  total: number;
  orders: number;
  avg_ticket: number;
  items_sold: number;
  by_method: { method: PaymentMethod; total: number; count: number }[];
  by_category: { name: string; quantity: number; revenue: number }[];
  top_items: { name: string; category_name: string | null; quantity: number; revenue: number }[];
  series: { date: string; total: number; orders: number }[];
}
